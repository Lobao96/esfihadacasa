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

// ---------------------------------------------------------------- avisos
// Notificacoes no telemovel (Web Push). Enviamos um aviso sem conteudo:
// o telemovel mostra "Novo pedido" e, ao tocar, abre o painel. Assim nao
// e preciso cifrar nada e o aviso chega mesmo com a app fechada.

const VAPID_PUBLIC = 'BPwKdY9BLSbv8m5X1wSHI2xDApg4faHlpEZmjCgC3Qp8HawDrnhXsG7rJcw66c2bj7HEmvc9O4YWHcZlhLz5rqg';
const VAPID_X = '_Ap1j0EtJu_yblfXBIcjbEMCmDh9oeWkRmaMKALdCnw';
const VAPID_Y = 'HawDrnhXsG7rJcw66c2bj7HEmvc9O4YWHcZlhLz5rqg';
const VAPID_SUB = 'mailto:96miguelsantos@gmail.com';

function b64url(buf) {
  let s = '';
  const a = new Uint8Array(buf);
  for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function jwtVapid(aud, env) {
  const chave = await crypto.subtle.importKey(
    'jwk',
    { kty: 'EC', crv: 'P-256', x: VAPID_X, y: VAPID_Y, d: env.VAPID_PRIVATE, ext: true },
    { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']
  );
  const cab = b64url(new TextEncoder().encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const corpo = b64url(new TextEncoder().encode(JSON.stringify({
    aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: VAPID_SUB,
  })));
  const dados = new TextEncoder().encode(cab + '.' + corpo);
  const ass = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, chave, dados);
  return cab + '.' + corpo + '.' + b64url(ass);
}

async function avisarTelemovel(env) {
  if (!env.VAPID_PRIVATE) return;
  const { results } = await env.DB.prepare('SELECT endpoint FROM subscricoes').all();
  if (!results || !results.length) return;

  const porOrigem = {};
  for (const r of results) {
    try { (porOrigem[new URL(r.endpoint).origin] ||= []).push(r.endpoint); } catch (e) {}
  }
  for (const origem of Object.keys(porOrigem)) {
    let jwt;
    try { jwt = await jwtVapid(origem, env); } catch (e) { continue; }
    for (const endpoint of porOrigem[origem]) {
      try {
        const r = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'TTL': '600',
            'Urgency': 'high',
            'Content-Length': '0',
            'Authorization': `vapid t=${jwt}, k=${VAPID_PUBLIC}`,
          },
        });
        // 404 ou 410: o telemovel desinstalou ou revogou. Limpa-se.
        if (r.status === 404 || r.status === 410) {
          await env.DB.prepare('DELETE FROM subscricoes WHERE endpoint = ?').bind(endpoint).run();
        }
      } catch (e) { /* um aviso falhado nao pode partir o pedido */ }
    }
  }
}

async function subscrever(request, env) {
  let b;
  try { b = await request.json(); } catch (e) { return j({ ok: false }, 400); }
  if (!b.endpoint) return j({ ok: false, erro: 'sem endpoint' }, 400);
  await env.DB.prepare(
    `INSERT INTO subscricoes (endpoint, p256dh, auth, criado_em) VALUES (?, ?, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth`
  ).bind(limpar(b.endpoint, 700), limpar(b.p256dh, 200), limpar(b.auth, 100),
         new Date().toISOString()).run();
  return j({ ok: true });
}

async function testarAviso(request, env, ctx) {
  ctx.waitUntil(avisarTelemovel(env));
  return j({ ok: true });
}

// ---------------------------------------------------------------- entregas
// Cotacao real do Uber Direct: o cliente escreve a morada e o site pergunta
// ao Uber quanto custa levar ate la. A morada de recolha vive so aqui no
// servidor, nunca na pagina.

let tokenCache = { valor: null, expira: 0 };

async function tokenUber(env) {
  if (tokenCache.valor && Date.now() < tokenCache.expira) return tokenCache.valor;
  const corpo = new URLSearchParams({
    client_id: env.UBER_CLIENT_ID || '',
    client_secret: env.UBER_CLIENT_SECRET || '',
    grant_type: 'client_credentials',
    scope: 'eats.deliveries',
  });
  const r = await fetch('https://auth.uber.com/oauth/v2/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: corpo.toString(),
  });
  if (!r.ok) {
    const corpoErro = await r.text().catch(() => '');
    throw new Error('uber auth ' + r.status + ' ' + corpoErro.slice(0, 300));
  }
  const d = await r.json();
  tokenCache = {
    valor: d.access_token,
    expira: Date.now() + Math.max(60, (d.expires_in || 3600) - 300) * 1000,
  };
  return tokenCache.valor;
}

// O que o cliente paga pela entrega depende de quanto a Uber cobra
// realmente (testado ao vivo: o custo sobe de forma consistente com a
// distancia real -- 3,94€ na propria rua da cozinha, 6,52€ ao Parchal,
// 9,10€ ao Alvor -- por isso e um bom filtro de zona, ao contrario do
// campo "duration" da cotacao, que tem sempre um piso de ~40min mesmo
// para distancia zero e nao reflete o tempo real).
//
// Por isso ha duas faixas de preco: perto (cobra 3,99€) e zona alargada
// como Parchal/Alvor (cobra 7,99€, para cobrir o custo mais alto do Uber
// nessas zonas). Em ambas as faixas perde-se no maximo ~2€ por entrega
// se o Uber cobrar o maximo permitido nessa faixa. Acima da ultima faixa,
// a entrega e recusada -- nunca por estar numa localidade em vez de
// outra, so pelo custo real que o Uber cobra para lá chegar.
const ENTREGA_FAIXAS = [
  { custo_max_cent: 599, cobra_cent: 399 }, // zona perto
  { custo_max_cent: 999, cobra_cent: 799 }, // zona alargada (ex.: Parchal, Alvor)
];
const ENTREGA_FIXA_CENT = ENTREGA_FAIXAS[0].cobra_cent; // usado so na rede de seguranca (ver semUber)

// O campo "duration" da cotacao fica so como rede de seguranca contra
// casos verdadeiramente extremos -- quem faz o corte de zona e o custo.
const ENTREGA_ETA_MAX_MIN = 60;

function faixaDeEntrega(custoCent) {
  return ENTREGA_FAIXAS.find(f => custoCent <= f.custo_max_cent) || null;
}

// Rede de seguranca por codigo postal. So entra em jogo quando o Uber falha
// tecnicamente (nao responde, erro de rede, etc.) ou quando o autocomplete
// de moradas nao estiver disponivel: nunca decide enquanto o Uber conseguir
// responder normalmente. Construida a partir dos codigos postais reais dos
// CTT (base de dados oficial) para Portimao + Praia da Rocha, Alvor,
// Ferragudo e Parchal -- excluindo deliberadamente Estombar, Lagoa e
// Mexilhoeira Grande, que ficam fora da zona de entrega de 15 min.
const CP_SEGURANCA = [
  { prefixo: '8500', min: 69, max: 69 }, // Portimao
  { prefixo: '8500', min: 73, max: 73 }, // Portimao
  { prefixo: '8500', min: 75, max: 78 }, // Portimao
  { prefixo: '8500', min: 141, max: 141 }, // Portimao
  { prefixo: '8500', min: 286, max: 286 }, // Portimao
  { prefixo: '8500', min: 289, max: 294 }, // Portimao
  { prefixo: '8500', min: 299, max: 300 }, // Portimao
  { prefixo: '8500', min: 302, max: 303 }, // Portimao
  { prefixo: '8500', min: 305, max: 305 }, // Portimao
  { prefixo: '8500', min: 307, max: 311 }, // Portimao
  { prefixo: '8500', min: 313, max: 314 }, // Portimao
  { prefixo: '8500', min: 316, max: 316 }, // Portimao
  { prefixo: '8500', min: 318, max: 319 }, // Portimao
  { prefixo: '8500', min: 321, max: 321 }, // Portimao
  { prefixo: '8500', min: 323, max: 323 }, // Portimao
  { prefixo: '8500', min: 325, max: 325 }, // Portimao
  { prefixo: '8500', min: 328, max: 328 }, // Portimao
  { prefixo: '8500', min: 332, max: 333 }, // Portimao
  { prefixo: '8500', min: 336, max: 336 }, // Portimao
  { prefixo: '8500', min: 339, max: 341 }, // Portimao
  { prefixo: '8500', min: 343, max: 345 }, // Portimao
  { prefixo: '8500', min: 347, max: 348 }, // Portimao
  { prefixo: '8500', min: 352, max: 353 }, // Portimao
  { prefixo: '8500', min: 356, max: 356 }, // Portimao
  { prefixo: '8500', min: 363, max: 363 }, // Portimao
  { prefixo: '8500', min: 367, max: 367 }, // Portimao
  { prefixo: '8500', min: 371, max: 372 }, // Portimao
  { prefixo: '8500', min: 381, max: 384 }, // Portimao
  { prefixo: '8500', min: 396, max: 396 }, // Portimao
  { prefixo: '8500', min: 399, max: 399 }, // Portimao
  { prefixo: '8500', min: 402, max: 402 }, // Portimao
  { prefixo: '8500', min: 406, max: 406 }, // Portimao
  { prefixo: '8500', min: 411, max: 411 }, // Portimao
  { prefixo: '8500', min: 416, max: 427 }, // Portimao
  { prefixo: '8500', min: 429, max: 444 }, // Portimao
  { prefixo: '8500', min: 448, max: 449 }, // Portimao
  { prefixo: '8500', min: 454, max: 456 }, // Portimao
  { prefixo: '8500', min: 458, max: 461 }, // Portimao
  { prefixo: '8500', min: 463, max: 467 }, // Portimao
  { prefixo: '8500', min: 469, max: 469 }, // Portimao
  { prefixo: '8500', min: 474, max: 478 }, // Portimao
  { prefixo: '8500', min: 480, max: 480 }, // Portimao
  { prefixo: '8500', min: 483, max: 486 }, // Portimao
  { prefixo: '8500', min: 488, max: 494 }, // Portimao
  { prefixo: '8500', min: 496, max: 504 }, // Portimao
  { prefixo: '8500', min: 506, max: 515 }, // Portimao
  { prefixo: '8500', min: 518, max: 521 }, // Portimao
  { prefixo: '8500', min: 524, max: 527 }, // Portimao
  { prefixo: '8500', min: 530, max: 531 }, // Portimao
  { prefixo: '8500', min: 533, max: 540 }, // Portimao
  { prefixo: '8500', min: 542, max: 544 }, // Portimao
  { prefixo: '8500', min: 546, max: 576 }, // Portimao
  { prefixo: '8500', min: 578, max: 588 }, // Portimao
  { prefixo: '8500', min: 590, max: 590 }, // Portimao
  { prefixo: '8500', min: 592, max: 612 }, // Portimao
  { prefixo: '8500', min: 614, max: 635 }, // Portimao
  { prefixo: '8500', min: 638, max: 643 }, // Portimao
  { prefixo: '8500', min: 645, max: 657 }, // Portimao
  { prefixo: '8500', min: 659, max: 687 }, // Portimao
  { prefixo: '8500', min: 689, max: 699 }, // Portimao
  { prefixo: '8500', min: 701, max: 712 }, // Portimao
  { prefixo: '8500', min: 714, max: 716 }, // Portimao
  { prefixo: '8500', min: 718, max: 720 }, // Portimao
  { prefixo: '8500', min: 722, max: 725 }, // Portimao
  { prefixo: '8500', min: 728, max: 757 }, // Portimao
  { prefixo: '8500', min: 759, max: 761 }, // Portimao
  { prefixo: '8500', min: 763, max: 764 }, // Portimao
  { prefixo: '8500', min: 766, max: 766 }, // Portimao
  { prefixo: '8500', min: 768, max: 769 }, // Portimao
  { prefixo: '8500', min: 772, max: 772 }, // Portimao
  { prefixo: '8500', min: 775, max: 776 }, // Portimao
  { prefixo: '8500', min: 778, max: 778 }, // Portimao
  { prefixo: '8500', min: 780, max: 780 }, // Portimao
  { prefixo: '8500', min: 782, max: 782 }, // Portimao
  { prefixo: '8500', min: 784, max: 802 }, // Portimao
  { prefixo: '8500', min: 804, max: 815 }, // Portimao
  { prefixo: '8500', min: 818, max: 820 }, // Portimao
  { prefixo: '8500', min: 822, max: 824 }, // Portimao
  { prefixo: '8500', min: 826, max: 827 }, // Portimao
  { prefixo: '8500', min: 830, max: 833 }, // Portimao
  { prefixo: '8500', min: 835, max: 835 }, // Portimao
  { prefixo: '8500', min: 841, max: 844 }, // Portimao
  { prefixo: '8500', min: 847, max: 847 }, // Portimao
  { prefixo: '8500', min: 992, max: 992 }, // Portimao
  { prefixo: '8500', min: 995, max: 995 }, // Portimao
  { prefixo: '8500', min: 997, max: 998 }, // Portimao
  { prefixo: '8500', min: 2, max: 3 }, // Alvor
  { prefixo: '8500', min: 5, max: 23 }, // Alvor
  { prefixo: '8500', min: 25, max: 35 }, // Alvor
  { prefixo: '8500', min: 37, max: 37 }, // Alvor
  { prefixo: '8500', min: 44, max: 45 }, // Alvor
  { prefixo: '8500', min: 56, max: 58 }, // Alvor
  { prefixo: '8500', min: 74, max: 74 }, // Alvor
  { prefixo: '8500', min: 81, max: 81 }, // Alvor
  { prefixo: '8500', min: 84, max: 84 }, // Alvor
  { prefixo: '8500', min: 87, max: 87 }, // Alvor
  { prefixo: '8500', min: 322, max: 322 }, // Alvor
  { prefixo: '8500', min: 329, max: 329 }, // Alvor
  { prefixo: '8500', min: 335, max: 335 }, // Alvor
  { prefixo: '8500', min: 777, max: 777 }, // Alvor
  { prefixo: '8500', min: 783, max: 783 }, // Alvor
  { prefixo: '8500', min: 996, max: 996 }, // Alvor
  { prefixo: '8400', min: 202, max: 215 }, // Ferragudo
  { prefixo: '8400', min: 219, max: 262 }, // Ferragudo
  { prefixo: '8400', min: 275, max: 277 }, // Ferragudo
  { prefixo: '8400', min: 279, max: 279 }, // Ferragudo
  { prefixo: '8400', min: 282, max: 282 }, // Ferragudo
  { prefixo: '8400', min: 287, max: 287 }, // Ferragudo
  { prefixo: '8400', min: 996, max: 996 }, // Ferragudo
  { prefixo: '8400', min: 600, max: 621 }, // Parchal
  { prefixo: '8400', min: 623, max: 625 }, // Parchal
  { prefixo: '8400', min: 651, max: 652 }, // Parchal
  { prefixo: '8400', min: 655, max: 670 }, // Parchal
];

function codigoPostalSeguro(cp) {
  const m = (cp || '').trim().match(/^(\d{4})-?(\d{3})$/);
  if (!m) return false;
  const prefixo = m[1];
  const sufixo = parseInt(m[2], 10);
  return CP_SEGURANCA.some(r => r.prefixo === prefixo && sufixo >= r.min && sufixo <= r.max);
}

async function cotacao(request, env) {
  let b;
  try { b = await request.json(); } catch (e) { return j({ ok: false, erro: 'corpo invalido' }, 400); }

  const rua = limpar(b.morada, 200);
  if (!rua || rua.length < 5) return j({ ok: false, erro: 'morada curta' }, 400);
  const cp = limpar(b.codigo_postal, 12) || '';

  // Uber nao respondeu (config em falta, falha de autenticacao, erro de
  // rede ou resposta invalida): cai-se na rede de seguranca do codigo
  // postal em vez de aceitar as cegas. "motivo" e so para diagnostico
  // (nunca aparece para o cliente, so quem consultar a resposta a mao) --
  // ajuda a perceber ONDE a chamada ao Uber esta a falhar.
  function semUber(motivo, detalhe) {
    if (codigoPostalSeguro(cp)) {
      return j({ ok: true, fee_cent: ENTREGA_FIXA_CENT, custo_cent: 0, quote_id: null, minutos: null, expira: null, uber_motivo: motivo, uber_detalhe: detalhe });
    }
    return j({ ok: false, erro: 'fora_de_alcance', uber_motivo: motivo, uber_detalhe: detalhe }, 200);
  }

  if (!env.UBER_CLIENT_ID || !env.UBER_CLIENT_SECRET || !env.UBER_CUSTOMER_ID || !env.UBER_PICKUP) {
    return semUber('sem_config');
  }

  const destino = {
    street_address: [rua],
    city: limpar(b.localidade, 60) || 'Portimão',
    state: 'Faro',
    zip_code: cp || '8500',
    country: 'PT',
  };

  let token;
  try { token = await tokenUber(env); }
  catch (e) { return semUber('falha_autenticacao', String(e && e.message || e)); }

  let r, d;
  try {
    r = await fetch(
      `https://api.uber.com/v1/customers/${env.UBER_CUSTOMER_ID}/delivery_quotes`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'authorization': 'Bearer ' + token },
        body: JSON.stringify({
          pickup_address: env.UBER_PICKUP,
          dropoff_address: JSON.stringify(destino),
          // Sem isto o Uber assume que a comida ainda nao esta pronta e
          // devolve uma estimativa com uma folga grande por omissao (~30min)
          // mesmo para moradas muito perto. Ao dizer que a recolha pode ser
          // "agora", a estimativa reflete so o tempo real de despacho + estrada.
          pickup_ready_dt: new Date().toISOString(),
        }),
      }
    );
    d = await r.json().catch(() => ({}));
  } catch (e) {
    return semUber('erro_de_rede', String(e && e.message || e));
  }
  if (!r.ok) return semUber('uber_recusou_' + r.status, (d && (d.message || d.error || JSON.stringify(d))) || null);

  const minutos = d.duration || null;
  if (minutos && minutos > ENTREGA_ETA_MAX_MIN) {
    return j({ ok: false, erro: 'fora_de_alcance', minutos }, 200);
  }
  const custo = d.fee || 0;
  const faixa = faixaDeEntrega(custo);
  if (!faixa) {
    return j({ ok: false, erro: 'fora_de_alcance', minutos, custo_cent: custo }, 200);
  }

  return j({
    ok: true,
    fee_cent: faixa.cobra_cent,
    custo_cent: custo,
    quote_id: d.id || null,
    minutos,
    expira: d.expires || null,
  });
}

// ---------------------------------------------------------------- pedidos

async function novoPedido(request, env, ctx) {
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

  if (ctx && ctx.waitUntil) ctx.waitUntil(avisarTelemovel(env));

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

    // Atalhos curtos e limpos para divulgacao. Guardam a origem num cookie
    // e mandam o visitante para o endereco normal, sem parametros a vista.
    const ATALHOS = {
      '/ig': 'instagram', '/story': 'instagram-stories', '/meta': 'meta',
      '/fb': 'facebook', '/g': 'google-perfil', '/gr': 'grupos', '/papel': 'papel',
    };
    const atalho = ATALHOS[p.replace(/\/$/, '')];
    if (atalho) {
      const campanha = url.searchParams.get('c') || '';
      return new Response(null, {
        status: 302,
        headers: {
          'Location': '/',
          'Set-Cookie': `origem=${encodeURIComponent(atalho)}|${encodeURIComponent(campanha)}; Path=/; Max-Age=2592000; SameSite=Lax`,
          'Cache-Control': 'no-store',
        },
      });
    }

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
        return await novoPedido(request, env, ctx);
      }
      if (p === '/api/acompanhar' && request.method === 'GET') {
        return await acompanhar(request, env);
      }
      if (p === '/api/visita' && request.method === 'POST') {
        return await registarVisita(request, env);
      }
      if (p === '/api/cotacao' && request.method === 'POST') {
        return await cotacao(request, env);
      }

      if (p.startsWith('/api/painel/')) {
        if (!autorizado(request, env)) return j({ ok: false, erro: 'nao autorizado' }, 401);
        if (p === '/api/painel/pedidos' && request.method === 'GET') return await listar(request, env);
        if (p === '/api/painel/pedido' && request.method === 'POST') return await mudarPedido(request, env);
        if (p === '/api/painel/stock' && request.method === 'POST') return await mudarStock(request, env);
        if (p === '/api/painel/limpar-ensaio' && request.method === 'POST') return await limparEnsaio(request, env);
        if (p === '/api/painel/analise' && request.method === 'GET') return await analise(request, env);
        if (p === '/api/painel/subscrever' && request.method === 'POST') return await subscrever(request, env);
        if (p === '/api/painel/testar-aviso' && request.method === 'POST') return await testarAviso(request, env, ctx);
        if (p === '/api/painel/chave' && request.method === 'GET') return j({ ok: true, chave: VAPID_PUBLIC });
      }

      return j({ ok: false, erro: 'nao existe' }, 404);
    } catch (e) {
      return j({ ok: false, erro: 'falha no servidor', detalhe: String(e && e.message || e) }, 500);
    }
  },
};
