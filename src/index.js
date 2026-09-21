// Esfiha da Casa — servidor dos pedidos.
// Tudo o que nao comecar por /api/ e servido a partir de public/ (o site).

const JSON_H = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };

function j(dados, status = 200) {
  return new Response(JSON.stringify(dados), { status, headers: JSON_H });
}

// Data e hora sempre no fuso de Lisboa, para o dia virar a horas certas.
function diaLisboa(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Lisbon', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
}
function horaLisboa(d = new Date()) {
  return new Intl.DateTimeFormat('pt-PT', {
    timeZone: 'Europe/Lisbon', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).format(d);
}

// Comparacao da palavra-passe sem revelar onde falhou.
function autorizado(request, env) {
  const dada = request.headers.get('x-painel-pass') || '';
  const certa = env.PAINEL_PASS || '';
  if (!certa || dada.length !== certa.length) return false;
  let d = 0;
  for (let i = 0; i < certa.length; i++) d |= dada.charCodeAt(i) ^ certa.charCodeAt(i);
  return d === 0;
}

async function estadoDoDia(db, dia) {
  let r = await db.prepare('SELECT total, usado, aberto FROM stock WHERE dia = ?').bind(dia).first();
  if (!r) {
    await db.prepare('INSERT OR IGNORE INTO stock (dia, total, usado, aberto) VALUES (?, 0, 0, 1)').bind(dia).run();
    r = { total: 0, usado: 0, aberto: 1 };
  }
  const ilimitado = !r.total;               // total 0 = sem limite definido
  const restante = ilimitado ? null : Math.max(0, r.total - r.usado);
  return {
    dia,
    total: r.total,
    usado: r.usado,
    restante,
    ilimitado,
    aberto: !!r.aberto && (ilimitado || restante > 0),
  };
}

function limpar(v, max = 400) {
  if (v === null || v === undefined) return null;
  return String(v).slice(0, max);
}

// ---------------------------------------------------------------- pedidos

async function novoPedido(request, env) {
  let b;
  try { b = await request.json(); } catch (e) { return j({ ok: false, erro: 'corpo invalido' }, 400); }

  const dia = diaLisboa();
  const ensaio = b.ensaio ? 1 : 0;
  const st = await estadoDoDia(env.DB, dia);
  if (!ensaio && !st.aberto) {
    return j({ ok: false, erro: 'esgotado', estado: st }, 409);
  }

  const agora = new Date().toISOString();
  // b.itens pode ser a lista simples (formato antigo) ou o objecto com
  // linhas, producao e bebidas (formato novo). Guarda-se tal como vem.
  const itens = JSON.stringify(b.itens && typeof b.itens === 'object' ? b.itens : []);

  // O numero da fila sai do maximo do proprio dia, numa so instrucao,
  // para dois pedidos ao mesmo segundo nao apanharem o mesmo numero.
  const res = await env.DB.prepare(
    `INSERT INTO pedidos
       (dia, numero, senha, ensaio, modo, localidade, morada, total_cent, n_esfihas, itens, mensagem, criado_em)
     SELECT ?, COALESCE(MAX(numero), 0) + 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
       FROM pedidos WHERE dia = ? AND ensaio = ?
     RETURNING id, numero`
  ).bind(
    dia, limpar(b.senha, 40), ensaio, limpar(b.modo, 20), limpar(b.localidade, 80),
    limpar(b.morada, 300), Math.max(0, parseInt(b.total_cent, 10) || 0),
    Math.max(0, parseInt(b.n_esfihas, 10) || 0), itens, limpar(b.mensagem, 4000), agora,
    dia, ensaio
  ).first();

  return j({ ok: true, id: res.id, numero: res.numero, dia, estado: await estadoDoDia(env.DB, dia) });
}

// ---------------------------------------------------------------- painel

async function listar(request, env) {
  const url = new URL(request.url);
  const dia = url.searchParams.get('dia') || diaLisboa();
  const { results } = await env.DB.prepare(
    `SELECT id, numero, senha, ensaio, estado, pago, modo, localidade, morada,
            total_cent, n_esfihas, itens, mensagem, criado_em, atualizado_em
       FROM pedidos WHERE dia = ? ORDER BY ensaio ASC, numero ASC`
  ).bind(dia).all();
  return j({ ok: true, dia, pedidos: results, estado: await estadoDoDia(env.DB, dia) });
}

const ESTADOS = ['novo', 'preparacao', 'caminho', 'entregue', 'cancelado'];

async function mudarPedido(request, env) {
  let b;
  try { b = await request.json(); } catch (e) { return j({ ok: false, erro: 'corpo invalido' }, 400); }
  const id = parseInt(b.id, 10);
  if (!id) return j({ ok: false, erro: 'id em falta' }, 400);

  const p = await env.DB.prepare('SELECT * FROM pedidos WHERE id = ?').bind(id).first();
  if (!p) return j({ ok: false, erro: 'pedido nao encontrado' }, 404);

  const estado = b.estado && ESTADOS.includes(b.estado) ? b.estado : p.estado;
  const pago = b.pago === undefined ? p.pago : (b.pago ? 1 : 0);
  const agora = new Date().toISOString();

  // O stock so desce quando o pedido entra em preparacao, e uma unica vez:
  // pedidos abandonados nao gastam massa.
  const entraEmProducao = estado === 'preparacao' && !p.stock_debitado && !p.ensaio;
  const saiDeProducao = estado === 'cancelado' && p.stock_debitado && !p.ensaio;

  const lote = [
    env.DB.prepare('UPDATE pedidos SET estado = ?, pago = ?, atualizado_em = ?, stock_debitado = ? WHERE id = ?')
      .bind(estado, pago, agora,
            entraEmProducao ? 1 : (saiDeProducao ? 0 : p.stock_debitado), id),
  ];
  if (entraEmProducao) {
    lote.push(env.DB.prepare('UPDATE stock SET usado = usado + ? WHERE dia = ?').bind(p.n_esfihas || 0, p.dia));
  } else if (saiDeProducao) {
    lote.push(env.DB.prepare('UPDATE stock SET usado = MAX(0, usado - ?) WHERE dia = ?').bind(p.n_esfihas || 0, p.dia));
  }
  await env.DB.batch(lote);

  return j({ ok: true, estado: await estadoDoDia(env.DB, p.dia) });
}

async function mudarStock(request, env) {
  let b;
  try { b = await request.json(); } catch (e) { return j({ ok: false, erro: 'corpo invalido' }, 400); }
  const dia = limpar(b.dia, 10) || diaLisboa();
  await estadoDoDia(env.DB, dia);
  if (b.total !== undefined) {
    await env.DB.prepare('UPDATE stock SET total = ? WHERE dia = ?')
      .bind(Math.max(0, parseInt(b.total, 10) || 0), dia).run();
  }
  if (b.aberto !== undefined) {
    await env.DB.prepare('UPDATE stock SET aberto = ? WHERE dia = ?').bind(b.aberto ? 1 : 0, dia).run();
  }
  return j({ ok: true, estado: await estadoDoDia(env.DB, dia) });
}

async function limparEnsaio(request, env) {
  const r = await env.DB.prepare('DELETE FROM pedidos WHERE ensaio = 1').run();
  return j({ ok: true, apagados: r.meta ? r.meta.changes : null });
}

// ---------------------------------------------------------------- entrada

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const p = url.pathname;

    // Paginas: o browser pode guardar, mas tem de confirmar com o servidor
    // se ha versao nova antes de a reutilizar. Sem isto, quem deixa a loja
    // aberta fica preso a uma versao antiga sem dar por nada.
    if (!p.startsWith('/api/')) {
      const r = await env.ASSETS.fetch(request);
      const tipo = r.headers.get('content-type') || '';
      if (tipo.includes('text/html')) {
        const h = new Headers(r.headers);
        h.set('cache-control', 'no-cache, must-revalidate');
        return new Response(r.body, { status: r.status, statusText: r.statusText, headers: h });
      }
      return r;
    }

    if (request.method === 'OPTIONS') return new Response(null, { status: 204 });

    try {
      if (p === '/api/estado' && request.method === 'GET') {
        return j({ ok: true, estado: await estadoDoDia(env.DB, diaLisboa()), hora: horaLisboa() });
      }
      if (p === '/api/pedido' && request.method === 'POST') {
        return await novoPedido(request, env);
      }

      if (p.startsWith('/api/painel/')) {
        if (!autorizado(request, env)) return j({ ok: false, erro: 'nao autorizado' }, 401);
        if (p === '/api/painel/pedidos' && request.method === 'GET') return await listar(request, env);
        if (p === '/api/painel/pedido' && request.method === 'POST') return await mudarPedido(request, env);
        if (p === '/api/painel/stock' && request.method === 'POST') return await mudarStock(request, env);
        if (p === '/api/painel/limpar-ensaio' && request.method === 'POST') return await limparEnsaio(request, env);
      }

      return j({ ok: false, erro: 'nao existe' }, 404);
    } catch (e) {
      return j({ ok: false, erro: 'falha no servidor', detalhe: String(e && e.message || e) }, 500);
    }
  },
};
