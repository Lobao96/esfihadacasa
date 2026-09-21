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

// Token curto e sem letras confundiveis, para o link de acompanhamento.
function novoToken() {
  const L = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const r = new Uint8Array(7);
  crypto.getRandomValues(r);
  return Array.from(r, x => L[x % L.length]).join('');
}

function soDigitos(v) {
  if (!v) return null;
  const d = String(v).replace(/[^0-9+]/g, '').slice(0, 20);
  return d.length >= 9 ? d : null;
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
  const token = novoToken();

  // O numero da fila sai do maximo do proprio dia, numa so instrucao,
  // para dois pedidos ao mesmo segundo nao apanharem o mesmo numero.
  const res = await env.DB.prepare(
    `INSERT INTO pedidos
       (dia, numero, senha, ensaio, modo, localidade, morada, total_cent, n_esfihas,
        itens, mensagem, criado_em, token, telefone, origem, campanha)
     SELECT ?, COALESCE(MAX(numero), 0) + 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
       FROM pedidos WHERE dia = ? AND ensaio = ?
     RETURNING id, numero, token`
  ).bind(
    dia, limpar(b.senha, 40), ensaio, limpar(b.modo, 20), limpar(b.localidade, 80),
    limpar(b.morada, 300), Math.max(0, parseInt(b.total_cent, 10) || 0),
    Math.max(0, parseInt(b.n_esfihas, 10) || 0), itens, limpar(b.mensagem, 4000), agora,
    token, soDigitos(b.telefone), limpar(b.origem, 60), limpar(b.campanha, 80),
    dia, ensaio
  ).first();

  return j({ ok: true, id: res.id, numero: res.numero, token: res.token, dia,
             estado: await estadoDoDia(env.DB, dia) });
}

// Pagina publica de acompanhamento: devolve o minimo, nunca morada nem telefone.
async function acompanhar(request, env) {
  const url = new URL(request.url);
  const tk = (url.searchParams.get('t') || '').toUpperCase().slice(0, 12);
  if (!tk) return j({ ok: false, erro: 'sem codigo' }, 400);
  const p = await env.DB.prepare(
    `SELECT numero, estado, pago, modo, localidade, total_cent, n_esfihas,
            itens, criado_em, atualizado_em, ensaio
       FROM pedidos WHERE token = ?`
  ).bind(tk).first();
  if (!p) return j({ ok: false, erro: 'nao encontrado' }, 404);
  return j({ ok: true, pedido: p });
}

async function registarVisita(request, env) {
  let b;
  try { b = await request.json(); } catch (e) { return j({ ok: true }); }
  await env.DB.prepare(
    'INSERT INTO visitas (dia, origem, campanha, pagina, criado_em) VALUES (?, ?, ?, ?, ?)'
  ).bind(diaLisboa(), limpar(b.origem, 60), limpar(b.campanha, 80),
         limpar(b.pagina, 120), new Date().toISOString()).run();
  return j({ ok: true });
}

// ---------------------------------------------------------------- painel

async function listar(request, env) {
  const url = new URL(request.url);
  const dia = url.searchParams.get('dia') || diaLisboa();
  const { results } = await env.DB.prepare(
    `SELECT id, numero, senha, ensaio, estado, pago, modo, localidade, morada,
            total_cent, n_esfihas, itens, mensagem, criado_em, atualizado_em,
            token, telefone, origem
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
  // pedidos abandonados nao gastam massa. Os pedidos de ensaio descontam
  // tal e qual, para o ensaio ser fiel; o "Apagar ensaios" devolve tudo.
  const entraEmProducao = estado === 'preparacao' && !p.stock_debitado;
  const saiDeProducao = estado === 'cancelado' && p.stock_debitado;

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
  // Devolve ao contador as esfihas que os ensaios tinham consumido, dia a dia,
  // e so depois apaga os pedidos.
  const { results } = await env.DB.prepare(
    `SELECT dia, SUM(n_esfihas) AS n FROM pedidos
      WHERE ensaio = 1 AND stock_debitado = 1 GROUP BY dia`
  ).all();
  const lote = (results || []).map(r =>
    env.DB.prepare('UPDATE stock SET usado = MAX(0, usado - ?) WHERE dia = ?').bind(r.n || 0, r.dia));
  lote.push(env.DB.prepare('DELETE FROM pedidos WHERE ensaio = 1'));
  await env.DB.batch(lote);
  return j({ ok: true, estado: await estadoDoDia(env.DB, diaLisboa()) });
}

// ---------------------------------------------------------------- analise

// Aceita ?dias=N ou ?de=AAAA-MM-DD&ate=AAAA-MM-DD.
function intervalo(url) {
  const fmt = /^\d{4}-\d{2}-\d{2}$/;
  let de = url.searchParams.get('de') || '';
  let ate = url.searchParams.get('ate') || '';
  if (fmt.test(de) && fmt.test(ate)) {
    if (de > ate) { const x = de; de = ate; ate = x; }
    return { de, ate };
  }
  const dias = Math.min(731, Math.max(1, parseInt(url.searchParams.get('dias'), 10) || 30));
  const hoje = diaLisboa();
  const inicio = diaLisboa(new Date(Date.now() - (dias - 1) * 864e5));
  return { de: inicio, ate: hoje };
}

// Hora de Lisboa a partir do instante gravado, sem truques de fuso.
function horaDe(iso) {
  try {
    return parseInt(new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Lisbon', hour: '2-digit', hour12: false,
    }).format(new Date(iso)), 10);
  } catch (e) { return null; }
}

async function analise(request, env) {
  const url = new URL(request.url);
  const { de, ate } = intervalo(url);

  const { results: linhas } = await env.DB.prepare(
    `SELECT dia, criado_em, modo, localidade, origem, total_cent, n_esfihas, itens
       FROM pedidos
      WHERE ensaio = 0 AND estado <> 'cancelado' AND dia >= ? AND dia <= ?
      ORDER BY criado_em LIMIT 5000`
  ).bind(de, ate).all();

  const { results: vis } = await env.DB.prepare(
    `SELECT COALESCE(NULLIF(origem, ''), 'direto') AS origem, COUNT(*) AS visitas
       FROM visitas WHERE dia >= ? AND dia <= ? GROUP BY origem ORDER BY visitas DESC`
  ).bind(de, ate).all();

  const somar = (o, k, n) => { if (k) o[k] = (o[k] || 0) + n; };
  const dias = {}, horas = {}, zonas = {}, origens = {};
  const sabores = {}, extras = {}, bebidas = {};
  let receita = 0, esfihas = 0, entregas = 0;

  for (const r of linhas || []) {
    receita += r.total_cent || 0;
    esfihas += r.n_esfihas || 0;
    if (r.modo === 'entrega') entregas++;

    const d = dias[r.dia] || (dias[r.dia] = { dia: r.dia, pedidos: 0, receita: 0, esfihas: 0 });
    d.pedidos++; d.receita += r.total_cent || 0; d.esfihas += r.n_esfihas || 0;

    const h = horaDe(r.criado_em);
    if (h !== null) {
      const x = horas[h] || (horas[h] = { hora: h, pedidos: 0, receita: 0 });
      x.pedidos++; x.receita += r.total_cent || 0;
    }

    const zona = r.modo === 'entrega' ? (r.localidade || '(por confirmar)') : '(retirada)';
    const z = zonas[zona] || (zonas[zona] = { zona, pedidos: 0, receita: 0 });
    z.pedidos++; z.receita += r.total_cent || 0;

    const orig = r.origem || 'direto';
    const o = origens[orig] || (origens[orig] = { origem: orig, pedidos: 0, receita: 0 });
    o.pedidos++; o.receita += r.total_cent || 0;

    let it = null;
    try { it = JSON.parse(r.itens || 'null'); } catch (e) {}
    if (it && !Array.isArray(it)) {
      for (const x of it.producao || []) {
        somar(sabores, x.sabor, x.n || 0);
        for (const e of x.extras || []) somar(extras, e, x.n || 0);
      }
      for (const b of it.bebidas || []) somar(bebidas, b.nome, b.n || 0);
    }
  }

  // Todos os dias do intervalo, mesmo os que nao tiveram pedidos.
  const serie = [];
  for (let x = new Date(de + 'T12:00:00Z'); diaLisboa(x) <= ate; x = new Date(+x + 864e5)) {
    const k = diaLisboa(x);
    serie.push(dias[k] || { dia: k, pedidos: 0, receita: 0, esfihas: 0 });
    if (serie.length > 800) break;
  }

  const ordenar = o => Object.keys(o).map(k => ({ nome: k, n: o[k] })).sort((a, b) => b.n - a.n);
  const valores = o => Object.keys(o).map(k => o[k]);
  const pedidos = (linhas || []).length;

  return j({
    ok: true, de, ate,
    resumo: { pedidos, receita, esfihas, entregas, medio: pedidos ? receita / pedidos : 0 },
    porDia: serie,
    porHora: valores(horas).sort((a, b) => a.hora - b.hora),
    porZona: valores(zonas).sort((a, b) => b.pedidos - a.pedidos),
    porOrigem: valores(origens).sort((a, b) => b.pedidos - a.pedidos),
    visitas: vis || [],
    sabores: ordenar(sabores), extras: ordenar(extras), bebidas: ordenar(bebidas),
  });
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
      if (p === '/api/acompanhar' && request.method === 'GET') {
        return await acompanhar(request, env);
      }
      if (p === '/api/visita' && request.method === 'POST') {
        return await registarVisita(request, env);
      }

      if (p.startsWith('/api/painel/')) {
        if (!autorizado(request, env)) return j({ ok: false, erro: 'nao autorizado' }, 401);
        if (p === '/api/painel/pedidos' && request.method === 'GET') return await listar(request, env);
        if (p === '/api/painel/pedido' && request.method === 'POST') return await mudarPedido(request, env);
        if (p === '/api/painel/stock' && request.method === 'POST') return await mudarStock(request, env);
        if (p === '/api/painel/limpar-ensaio' && request.method === 'POST') return await limparEnsaio(request, env);
        if (p === '/api/painel/analise' && request.method === 'GET') return await analise(request, env);
      }

      return j({ ok: false, erro: 'nao existe' }, 404);
    } catch (e) {
      return j({ ok: false, erro: 'falha no servidor', detalhe: String(e && e.message || e) }, 500);
    }
  },
};
