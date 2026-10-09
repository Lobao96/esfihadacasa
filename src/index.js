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
  // O total de esfihas por vender deixou de ser um numero escrito a mao:
  // e sempre a soma do stock real (salgadas congeladas por sabor + massa
  // doce pronta). Descer qualquer um desses automaticamente desce aqui.
  const { results: salgLinhas } = await db.prepare('SELECT nome, quantidade FROM stock_salgadas').all();
  const doce = await db.prepare('SELECT quantidade FROM stock_doces WHERE id = 1').first();
  const porSabor = {};
  let somaSalg = 0;
  for (const linha of (salgLinhas || [])) {
    porSabor[linha.nome] = linha.quantidade;
    somaSalg += linha.quantidade || 0;
  }
  const doceRestante = (doce && doce.quantidade) || 0;
  const total = somaSalg + doceRestante;
  const restante = Math.max(0, total);
  return {
    dia,
    total,
    usado: r.usado,
    restante,
    ilimitado: false,
    // Stock por sabor, publico (so numeros, sem nada sensivel) -- usado no
    // site para desativar logo no cartao um sabor esgotado, em vez de so
    // deixar saber la para o fim, ao tentar enviar o pedido.
    porSabor,
    doceRestante,
    // abertoManual e o que o dono escolheu no botao do painel (fechar/abrir loja).
    // aberto e o estado real que bloqueia pedidos: so fica aberto se o dono
    // quis abrir E ainda houver stock.
    abertoManual: !!r.aberto,
    aberto: !!r.aberto && restante > 0,
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

// ------------------------------------------------------------- bebidas
// O brinde automatico (10 esfihas -> 1 bebida gratis) e a oferta fixa do
// Combo Junta a Malta chegam marcados de forma diferente:
//  - brinde: nome vem com "(gratis)" no fim -- sabe-se exatamente qual bebida.
//  - combo2 (bebidaFixa): vem como uma linha opaca "Oferta Nx bebida... (a
//    escolha da casa)" -- nao se sabe qual garrafa foi de facto usada, por
//    isso NAO desconta stock por bebida especifica (fica por conta de quem
//    esta na loja ajustar a mao, ja que e quem escolhe a garrafa).
function nomeBaseBebida(nome) {
  return String(nome || '').replace(/\s*\(gr[áa]tis\)\s*$/i, '').trim();
}
function ehGratis(nome) {
  return /\(gr[áa]tis\)\s*$/i.test(String(nome || ''));
}
function ehOfertaOpaca(nome) {
  return /^Oferta\s/i.test(String(nome || '').trim());
}
function producaoDoItens(itensJson) {
  let it = null;
  try { it = JSON.parse(itensJson || 'null'); } catch (e) {}
  return (it && !Array.isArray(it) && it.producao) || [];
}

function bebidasDoItens(itensJson) {
  let it = null;
  try { it = JSON.parse(itensJson || 'null'); } catch (e) {}
  return (it && !Array.isArray(it) && it.bebidas) || [];
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
// NOTA (28/09): testado ao vivo, o custo minimo real da Uber ronda
// 4,80€-5,66€ mesmo para ruas normais dentro da propria Portimao -- ou
// seja, a faixa "perto" a cobrar 3,99€ ainda perde dinheiro na maioria
// das entregas, nao so nas mais longe. Fica assim por agora a pedido do
// dono (decisao consciente, nao um erro), mas precisa de ser revisto:
// falta calcular o impacto real disto juntando ao resto das despesas do
// negocio (nao so o custo direto do Uber).
//
// (10/10) A entrega passou a ser feita pela Andreza (estafeta propria),
// nao pelo estafeta da Uber -- ver mudarPedido()/painel. A chamada ao
// Uber aqui em baixo (cotarEntrega) fica so como *estimativa de distancia*
// para decidir se a morada fica dentro da area que a Andreza cobre, nunca
// para despachar de verdade. A pedido do dono, deixou de haver faixas por
// zona: entrega a 3,50€ fixos para toda a area Alvor a Lagoa (~10km por
// estrada a partir da loja em Portimao).
//
// O corte de zona e feito pelo TEMPO estimado (ENTREGA_ETA_MAX_MIN), nao
// pelo custo -- o preco que a Uber devolve pode variar com a hora do dia
// (picos, noite) mesmo para a mesma distancia, e isso ja rejeitou moradas
// dentro da zona (ex: Lagoa, de noite) so por o preco ter vindo mais alto
// nesse momento. O custo so serve de rede de seguranca contra um erro
// grosseiro de geocodificacao (morada que caiu a centenas de km).
const ENTREGA_FAIXAS = [
  { custo_max_cent: 2500, cobra_cent: 350 }, // rede de seguranca, nao e o corte real
];
const ENTREGA_FIXA_CENT = ENTREGA_FAIXAS[0].cobra_cent; // usado tambem na rede de seguranca (ver semUber)

// Corte por tempo: testado ao vivo, a Uber devolve um "duration" maior do
// que o tempo de condução puro do Google Maps (inclui folga de despacho) --
// uma morada em Lagoa Centro, a uns 14min reais de carro, ja passou dos
// 15min aqui. 20min da essa folga sem chegar a Carvoeiro ou Porches
// (mais longe ainda). O codigo postal (ver codigoPostalSeguro) continua a
// excluir de vez os concelhos errados (Lagos, Silves, Monchique).
const ENTREGA_ETA_MAX_MIN = 20;

function faixaDeEntrega(custoCent) {
  return ENTREGA_FAIXAS.find(f => custoCent <= f.custo_max_cent) || null;
}

// Primeiro filtro, antes de perguntar a Uber: o codigo postal tem de ser
// dos concelhos de Portimao ou Lagoa (Algarve) -- nunca aceita so porque a
// Uber, num momento de pouco transito, desse uma estimativa de tempo curta
// para um concelho errado. Confirmado nos CTT: prefixo 8500 = concelho de
// Portimao (Portimao, Praia da Rocha, Alvor, Mexilhoeira Grande); 8400 =
// concelho de Lagoa (Lagoa, Carvoeiro, Estombar, Ferragudo, Parchal,
// Porches). Os vizinhos ficam sempre de fora: Lagos e 8600, Silves e 8300,
// Monchique e 8550.
//
// Mas o concelho de Lagoa e grande -- Porches e Carvoeiro ficam fora do
// alcance real da Andreza, mesmo tendo codigo postal 8400. Por isso o
// codigo postal so exclui concelhos errados de vez; quem decide a zona de
// verdade e o tempo estimado (ENTREGA_ETA_MAX_MIN, mais abaixo), ate
// Lagoa Centro no maximo.
const CONCELHOS_ENTREGA = new Set(['8400', '8500']); // Lagoa, Portimao

function codigoPostalSeguro(cp) {
  const m = (cp || '').trim().match(/^(\d{4})-?(\d{3})$/);
  if (!m) return false;
  return CONCELHOS_ENTREGA.has(m[1]);
}

async function cotacao(request, env) {
  let b;
  try { b = await request.json(); } catch (e) { return j({ ok: false, erro: 'corpo invalido' }, 400); }

  const rua = limpar(b.morada, 200);
  if (!rua || rua.length < 5) return j({ ok: false, erro: 'morada curta' }, 400);
  const cp = limpar(b.codigo_postal, 12) || '';

  // O codigo postal e quem decide a zona, sempre que o temos -- nao so
  // quando a Uber falha. Um codigo postal fora de Portimao/Lagoa e
  // recusado logo aqui, nem chega a perguntar a Uber (nunca aceita so
  // porque a Uber, num momento de pouco transito, desse uma estimativa
  // de tempo curta para um sitio fora da zona).
  if (cp && !codigoPostalSeguro(cp)) {
    return j({ ok: false, erro: 'fora_de_alcance', uber_motivo: 'fora_do_concelho' }, 200);
  }

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
    opcional: !!faixa.opcional,
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
  // Mesmo com a loja aberta, um pedido individual pode pedir mais esfihas do
  // que o stock que resta (ex: restam 10 e o pedido tem um combo de 20).
  // Isso tem de ser travado aqui, nao so quando o stock geral chega a zero.
  const nEsfihasPedidas = Math.max(0, parseInt(b.n_esfihas, 10) || 0);
  if (!ensaio && !st.ilimitado && nEsfihasPedidas > st.restante) {
    return j({ ok: false, erro: 'sem_stock', estado: st }, 409);
  }

  // O check acima so olha para o TOTAL agregado (st.restante) -- mas isso
  // pode ainda ter unidades de OUTROS sabores mesmo que o sabor pedido
  // aqui esteja a 0. Sem este segundo check, dava para encomendar um
  // sabor esgotado desde que outro sabor ainda tivesse stock.
  if (!ensaio && !st.ilimitado) {
    const producaoPedida = (b.itens && typeof b.itens === 'object' && !Array.isArray(b.itens) && b.itens.producao) || [];
    const pedidoPorSabor = new Map();
    let docePedido = 0;
    for (const x of producaoPedida) {
      const n = Math.max(0, parseInt(x && x.n, 10) || 0);
      if (!n) continue;
      if (x.doce) docePedido += n;
      else if (x.sabor) pedidoPorSabor.set(x.sabor, (pedidoPorSabor.get(x.sabor) || 0) + n);
    }
    if (pedidoPorSabor.size || docePedido) {
      const { results: salgInfo } = await env.DB.prepare('SELECT nome, quantidade FROM stock_salgadas').all();
      const disponivelPorSabor = new Map((salgInfo || []).map(r => [r.nome, r.quantidade]));
      for (const [sabor, n] of pedidoPorSabor) {
        const disp = disponivelPorSabor.has(sabor) ? disponivelPorSabor.get(sabor) : 0;
        if (n > disp) {
          return j({ ok: false, erro: 'sem_stock_sabor', sabor, restante_sabor: disp, estado: st }, 409);
        }
      }
      if (docePedido) {
        const doceRow = await env.DB.prepare('SELECT quantidade FROM stock_doces WHERE id = 1').first();
        const dispDoce = (doceRow && doceRow.quantidade) || 0;
        if (docePedido > dispDoce) {
          return j({ ok: false, erro: 'sem_stock_sabor', sabor: 'doce', restante_sabor: dispDoce, estado: st }, 409);
        }
      }
    }
  }

  // Nome e telefone sao obrigatorios -- quem entrega (estafeta ou a propria
  // loja, na retirada) tem de saber a quem entregar e como contactar.
  const nomeCliente = limpar(b.nome, 120);
  if (!nomeCliente || nomeCliente.length < 2) return j({ ok: false, erro: 'nome obrigatorio' }, 400);
  const telCliente = soDigitos(b.telefone);
  if (!telCliente) return j({ ok: false, erro: 'telefone obrigatorio' }, 400);

  const agora = new Date().toISOString();
  // b.itens pode ser a lista simples (formato antigo) ou o objecto com
  // linhas, producao e bebidas (formato novo). Guarda-se tal como vem.
  const itens = JSON.stringify(b.itens && typeof b.itens === 'object' ? b.itens : []);
  const token = novoToken();

  // O numero dos pedidos reais nunca reinicia -- e continuo desde o
  // primeiro pedido do site, para nunca mostrar a um cliente que e "o
  // pedido numero 1" de um dia so porque foi o primeiro a chegar tarde.
  // Os pedidos de ensaio continuam com numeracao propria, reiniciada a
  // cada dia (sao so testes, e apagados regularmente pelo "Apagar
  // ensaios"), para nunca misturar com a numeracao real.
  const filtroNumero = ensaio ? 'dia = ? AND ensaio = 1' : 'ensaio = 0';
  const res = await env.DB.prepare(
    `INSERT INTO pedidos
       (dia, numero, senha, ensaio, modo, localidade, morada, total_cent, n_esfihas,
        itens, mensagem, criado_em, token, telefone, origem, campanha, nome, stock_debitado)
     SELECT ?, COALESCE(MAX(numero), 0) + 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1
       FROM pedidos WHERE ${filtroNumero}
     RETURNING id, numero, token`
  ).bind(
    dia, limpar(b.senha, 40), ensaio, limpar(b.modo, 20), limpar(b.localidade, 80),
    limpar(b.morada, 300), Math.max(0, parseInt(b.total_cent, 10) || 0),
    Math.max(0, parseInt(b.n_esfihas, 10) || 0), itens, limpar(b.mensagem, 4000), agora,
    token, telCliente, limpar(b.origem, 60), limpar(b.campanha, 80), nomeCliente,
    ...(ensaio ? [dia] : [])
  ).first();

  // O stock desce logo aqui, assim que o pedido e feito (vendido) -- nao so
  // quando o staff o marca "em preparacao" -- para o painel mostrar sempre
  // quantas esfihas/bebidas restam de verdade. Se o pedido for cancelado
  // depois, mudarPedido() devolve tudo (ve stock_debitado).
  const loteDebito = [
    env.DB.prepare('UPDATE stock SET usado = usado + ? WHERE dia = ?').bind(nEsfihasPedidas, dia),
  ];
  for (const x of producaoDoItens(itens)) {
    const n = parseInt(x.n, 10) || 0;
    if (!n) continue;
    if (x.doce) {
      loteDebito.push(env.DB.prepare(
        `UPDATE stock_doces SET quantidade = MAX(0, quantidade - ?), atualizado_em = ? WHERE id = 1`
      ).bind(n, agora));
    } else if (x.sabor) {
      loteDebito.push(env.DB.prepare(
        `UPDATE stock_salgadas SET quantidade = MAX(0, quantidade - ?), atualizado_em = ? WHERE nome = ?`
      ).bind(n, agora, x.sabor));
    }
  }
  for (const beb of bebidasDoItens(itens)) {
    if (ehOfertaOpaca(beb.nome)) continue;
    const nomeBeb = nomeBaseBebida(beb.nome);
    const n = parseInt(beb.n, 10) || 0;
    if (!nomeBeb || !n) continue;
    loteDebito.push(env.DB.prepare(
      `UPDATE stock_bebidas SET quantidade = MAX(0, quantidade - ?), atualizado_em = ? WHERE nome = ?`
    ).bind(n, agora, nomeBeb));
  }
  loteDebito.push(env.DB.prepare(
    `UPDATE stock_bebidas SET quantidade = MAX(0, quantidade - por_pedido), atualizado_em = ? WHERE por_pedido > 0`
  ).bind(agora));
  await env.DB.batch(loteDebito);

  if (ctx && ctx.waitUntil) ctx.waitUntil(avisarTelemovel(env));

  return j({ ok: true, id: res.id, numero: res.numero, token: res.token, dia,
             estado: await estadoDoDia(env.DB, dia) });
}

// Pagina publica de acompanhamento: devolve o minimo necessario para o
// cliente seguir o pedido. Inclui morada e telefone porque este link e
// tambem o que a loja reenvia ao estafeta -- para saber para onde ir e
// poder ligar/mandar mensagem ao cliente quando chegar. Protegido por um
// token aleatorio de 7 caracteres (nao e adivinhavel), nao por omissao.
async function acompanhar(request, env) {
  const url = new URL(request.url);
  const tk = (url.searchParams.get('t') || '').toUpperCase().slice(0, 12);
  if (!tk) return j({ ok: false, erro: 'sem codigo' }, 400);
  const p = await env.DB.prepare(
    `SELECT numero, estado, pago, modo, localidade, morada, telefone, nome, total_cent, n_esfihas,
            itens, criado_em, atualizado_em, ensaio
       FROM pedidos WHERE token = ?`
  ).bind(tk).first();
  if (!p) return j({ ok: false, erro: 'nao encontrado' }, 404);
  return j({ ok: true, pedido: p });
}

// Cria a entrega REAL no Uber Direct para um pedido (so entrega, nunca
// retirada). So e chamada quando o staff confirma explicitamente no
// painel -- nunca automaticamente. Pede sempre uma cotacao nova primeiro,
// porque a cotacao guardada no pedido pode ja ter expirado entre o
// cliente fazer o pedido e o staff carregar em "Comecar a fazer".
async function criarEntregaUberReal(request, env) {
  let b;
  try { b = await request.json(); } catch (e) { return j({ ok: false, erro: 'corpo invalido' }, 400); }
  const id = parseInt(b.id, 10);
  if (!id) return j({ ok: false, erro: 'id em falta' }, 400);

  const p = await env.DB.prepare('SELECT * FROM pedidos WHERE id = ?').bind(id).first();
  if (!p) return j({ ok: false, erro: 'pedido nao encontrado' }, 404);
  if (p.modo !== 'entrega') return j({ ok: false, erro: 'nao_e_entrega' }, 400);
  if (!p.morada || p.morada.length < 5) return j({ ok: false, erro: 'sem_morada' }, 200);

  let dados = {};
  try { dados = JSON.parse(p.itens || '{}') || {}; } catch (e) {}
  if (dados.entrega && dados.entrega.uber_delivery_id) {
    return j({ ok: false, erro: 'ja_pedido', delivery_id: dados.entrega.uber_delivery_id,
               tracking_url: dados.entrega.uber_tracking_url || null }, 200);
  }

  if (!env.UBER_CLIENT_ID || !env.UBER_CLIENT_SECRET || !env.UBER_CUSTOMER_ID || !env.UBER_PICKUP) {
    return j({ ok: false, erro: 'sem_config' }, 200);
  }

  const telDigitos = soDigitos(p.telefone || '');
  if (!telDigitos) return j({ ok: false, erro: 'sem_telefone' }, 200);
  const telE164 = '+' + (telDigitos.length === 9 ? '351' + telDigitos : telDigitos);

  const destino = {
    street_address: [p.morada],
    city: p.localidade || 'Portimão',
    state: 'Faro',
    zip_code: (dados.entrega && dados.entrega.codigo_postal) || '8500',
    country: 'PT',
  };

  let token;
  try { token = await tokenUber(env); }
  catch (e) { return j({ ok: false, erro: 'falha_autenticacao', detalhe: String(e && e.message || e) }, 200); }

  // Cotacao fresca, feita agora (nao reaproveita a do checkout).
  let rc, dc;
  try {
    rc = await fetch(
      `https://api.uber.com/v1/customers/${env.UBER_CUSTOMER_ID}/delivery_quotes`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'authorization': 'Bearer ' + token },
        body: JSON.stringify({
          pickup_address: env.UBER_PICKUP,
          dropoff_address: JSON.stringify(destino),
          pickup_ready_dt: new Date().toISOString(),
        }),
      }
    );
    dc = await rc.json().catch(() => ({}));
  } catch (e) {
    return j({ ok: false, erro: 'erro_de_rede_cotacao', detalhe: String(e && e.message || e) }, 200);
  }
  if (!rc.ok || !dc.id) {
    return j({ ok: false, erro: 'uber_recusou_cotacao_' + rc.status,
               detalhe: (dc && (dc.message || dc.error)) || null }, 200);
  }

  let rd, dd;
  try {
    rd = await fetch(
      `https://api.uber.com/v1/customers/${env.UBER_CUSTOMER_ID}/deliveries`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'authorization': 'Bearer ' + token },
        body: JSON.stringify({
          quote_id: dc.id,
          pickup_name: env.UBER_PICKUP_NOME || 'Esfiha da Casa',
          pickup_address: env.UBER_PICKUP,
          pickup_phone_number: env.UBER_PICKUP_TELEFONE || '+351938211480',
          dropoff_name: 'Pedido #' + p.numero,
          dropoff_address: JSON.stringify(destino),
          dropoff_phone_number: telE164,
          dropoff_notes: p.mensagem ? limpar(p.mensagem, 280) : undefined,
          manifest_items: [
            { name: 'Esfihas — pedido #' + p.numero, quantity: Math.max(1, p.n_esfihas || 1),
              price: p.total_cent || 0, vat_percentage: 0 },
          ],
          manifest_total_value: p.total_cent || 0,
        }),
      }
    );
    dd = await rd.json().catch(() => ({}));
  } catch (e) {
    return j({ ok: false, erro: 'erro_de_rede_entrega', detalhe: String(e && e.message || e) }, 200);
  }
  if (!rd.ok || !dd.id) {
    return j({ ok: false, erro: 'uber_recusou_entrega_' + rd.status,
               detalhe: (dd && (dd.message || dd.error || JSON.stringify(dd))) || null }, 200);
  }

  dados.entrega = Object.assign({}, dados.entrega, {
    uber_delivery_id: dd.id,
    uber_tracking_url: dd.tracking_url || null,
    uber_pedido_em: new Date().toISOString(),
    custo_real_cent: dd.fee || dc.fee || null,
  });
  await env.DB.prepare('UPDATE pedidos SET itens = ? WHERE id = ?').bind(JSON.stringify(dados), id).run();

  return j({ ok: true, delivery_id: dd.id, tracking_url: dd.tracking_url || null,
             custo_cent: dd.fee || dc.fee || null });
}

// Cancela no Uber uma entrega que ja tenha sido pedida para este pedido
// (usado quando um pedido de entrega e cancelado depois de o estafeta ja
// ter sido chamado).
async function cancelarEntregaUber(request, env) {
  let b;
  try { b = await request.json(); } catch (e) { return j({ ok: false, erro: 'corpo invalido' }, 400); }
  const id = parseInt(b.id, 10);
  if (!id) return j({ ok: false, erro: 'id em falta' }, 400);

  const p = await env.DB.prepare('SELECT * FROM pedidos WHERE id = ?').bind(id).first();
  if (!p) return j({ ok: false, erro: 'pedido nao encontrado' }, 404);

  let dados = {};
  try { dados = JSON.parse(p.itens || '{}') || {}; } catch (e) {}
  const deliveryId = dados.entrega && dados.entrega.uber_delivery_id;
  if (!deliveryId) return j({ ok: false, erro: 'sem_entrega_uber' }, 200);
  if (dados.entrega.uber_cancelada_em) return j({ ok: true, ja_cancelada: true });

  if (!env.UBER_CLIENT_ID || !env.UBER_CLIENT_SECRET || !env.UBER_CUSTOMER_ID) {
    return j({ ok: false, erro: 'sem_config' }, 200);
  }

  let token;
  try { token = await tokenUber(env); }
  catch (e) { return j({ ok: false, erro: 'falha_autenticacao', detalhe: String(e && e.message || e) }, 200); }

  let r;
  try {
    r = await fetch(
      `https://api.uber.com/v1/customers/${env.UBER_CUSTOMER_ID}/deliveries/${deliveryId}/cancel`,
      { method: 'POST', headers: { authorization: 'Bearer ' + token } }
    );
  } catch (e) {
    return j({ ok: false, erro: 'erro_de_rede', detalhe: String(e && e.message || e) }, 200);
  }
  if (!r.ok) {
    const corpoErro = await r.text().catch(() => '');
    return j({ ok: false, erro: 'uber_recusou_cancelamento_' + r.status, detalhe: corpoErro.slice(0, 300) }, 200);
  }

  dados.entrega.uber_cancelada_em = new Date().toISOString();
  await env.DB.prepare('UPDATE pedidos SET itens = ? WHERE id = ?').bind(JSON.stringify(dados), id).run();
  return j({ ok: true });
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
            token, telefone, nome, origem
       FROM pedidos WHERE dia = ? ORDER BY ensaio ASC, numero ASC`
  ).bind(dia).all();
  const { results: salgadas } = await env.DB.prepare(
    'SELECT nome, quantidade, minimo FROM stock_salgadas ORDER BY nome ASC'
  ).all();
  const doces = await env.DB.prepare(
    'SELECT quantidade, minimo FROM stock_doces WHERE id = 1'
  ).first();
  return j({ ok: true, dia, pedidos: results, estado: await estadoDoDia(env.DB, dia),
             salgadas: salgadas || [], doces: doces || { quantidade: 0, minimo: 0 } });
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

  // O stock ja desce na criacao do pedido (novoPedido), nao aqui -- isto
  // so cobre dois casos: um pedido antigo que por algum motivo ainda nao
  // tinha sido debitado ao chegar a preparacao, e o cancelamento, que
  // devolve o que foi descontado (pedidos de ensaio tambem descontam, para
  // o ensaio ser fiel; o "Apagar ensaios" devolve tudo).
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
  if (entraEmProducao || saiDeProducao) {
    const sinal = entraEmProducao ? -1 : 1;   // entra em produção = sai do stock; sai de produção (cancelado) = devolve
    for (const x of producaoDoItens(p.itens)) {
      const n = parseInt(x.n, 10) || 0;
      if (!n) continue;
      if (x.doce) {
        lote.push(env.DB.prepare(
          `UPDATE stock_doces SET quantidade = MAX(0, quantidade + ?), atualizado_em = ? WHERE id = 1`
        ).bind(sinal * n, agora));
      } else if (x.sabor) {
        lote.push(env.DB.prepare(
          `UPDATE stock_salgadas SET quantidade = MAX(0, quantidade + ?), atualizado_em = ? WHERE nome = ?`
        ).bind(sinal * n, agora, x.sabor));
      }
    }
    for (const beb of bebidasDoItens(p.itens)) {
      if (ehOfertaOpaca(beb.nome)) continue;   // nao se sabe qual garrafa foi -- ajusta-se a mao
      const nome = nomeBaseBebida(beb.nome);
      const n = parseInt(beb.n, 10) || 0;
      if (!nome || !n) continue;
      lote.push(env.DB.prepare(
        `UPDATE stock_bebidas SET quantidade = MAX(0, quantidade + ?), atualizado_em = ? WHERE nome = ?`
      ).bind(sinal * n, agora, nome));
    }
    // Ofertas fixas (ex.: 2 saquetas de ketchup por pedido) -- saem sempre,
    // independentemente do que o cliente escolheu.
    lote.push(env.DB.prepare(
      `UPDATE stock_bebidas SET quantidade = MAX(0, quantidade + (? * por_pedido)), atualizado_em = ? WHERE por_pedido > 0`
    ).bind(sinal, agora));
  }
  await env.DB.batch(lote);

  return j({ ok: true, estado: await estadoDoDia(env.DB, p.dia) });
}

async function mudarStock(request, env) {
  let b;
  try { b = await request.json(); } catch (e) { return j({ ok: false, erro: 'corpo invalido' }, 400); }
  const dia = limpar(b.dia, 10) || diaLisboa();
  await estadoDoDia(env.DB, dia);
  if (b.aberto !== undefined) {
    await env.DB.prepare('UPDATE stock SET aberto = ? WHERE dia = ?').bind(b.aberto ? 1 : 0, dia).run();
  }
  return j({ ok: true, estado: await estadoDoDia(env.DB, dia) });
}

async function stockPublicoBebidas(request, env) {
  const { results } = await env.DB.prepare(
    'SELECT nome, quantidade FROM stock_bebidas WHERE por_pedido = 0'
  ).all();
  return j({ ok: true, bebidas: results || [] });
}

async function listarBebidas(request, env) {
  const { results } = await env.DB.prepare(
    'SELECT nome, quantidade, minimo, por_pedido, atualizado_em FROM stock_bebidas ORDER BY por_pedido DESC, nome ASC'
  ).all();
  return j({ ok: true, bebidas: results || [] });
}

async function mudarBebidaStock(request, env) {
  let b;
  try { b = await request.json(); } catch (e) { return j({ ok: false, erro: 'corpo invalido' }, 400); }
  const nome = limpar(b.nome, 80);
  if (!nome) return j({ ok: false, erro: 'nome em falta' }, 400);
  const agora = new Date().toISOString();
  const porPedido = Math.max(0, parseInt(b.porPedido, 10) || 0);

  await env.DB.prepare(
    `INSERT INTO stock_bebidas (nome, quantidade, minimo, por_pedido, atualizado_em) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(nome) DO NOTHING`
  ).bind(nome, Math.max(0, parseInt(b.quantidade, 10) || 0), Math.max(0, parseInt(b.minimo, 10) || 0),
         porPedido, agora).run();

  if (b.quantidade !== undefined) {
    await env.DB.prepare('UPDATE stock_bebidas SET quantidade = ?, atualizado_em = ? WHERE nome = ?')
      .bind(Math.max(0, parseInt(b.quantidade, 10) || 0), agora, nome).run();
  }
  if (b.minimo !== undefined) {
    await env.DB.prepare('UPDATE stock_bebidas SET minimo = ?, atualizado_em = ? WHERE nome = ?')
      .bind(Math.max(0, parseInt(b.minimo, 10) || 0), agora, nome).run();
  }
  if (b.porPedido !== undefined) {
    await env.DB.prepare('UPDATE stock_bebidas SET por_pedido = ?, atualizado_em = ? WHERE nome = ?')
      .bind(porPedido, agora, nome).run();
  }
  return await listarBebidas(request, env);
}

async function listarSalgadas(request, env) {
  const { results } = await env.DB.prepare(
    'SELECT nome, quantidade, minimo, atualizado_em FROM stock_salgadas ORDER BY nome ASC'
  ).all();
  return j({ ok: true, salgadas: results || [] });
}

// Lista fechada -- os unicos sabores salgados que esta rota aceita. Isto
// evita que uma pagina antiga em cache (ou qualquer outro chamador) volte
// a criar linhas de sabores doces aqui, como ja aconteceu uma vez.
const SABORES_SALGADOS_VALIDOS = new Set([
  'A Tradicional', 'A Suculenta', 'A Caipira', 'A Queridinha',
]);

async function mudarSalgadaStock(request, env) {
  let b;
  try { b = await request.json(); } catch (e) { return j({ ok: false, erro: 'corpo invalido' }, 400); }
  const nome = limpar(b.nome, 80);
  if (!nome) return j({ ok: false, erro: 'nome em falta' }, 400);
  if (!SABORES_SALGADOS_VALIDOS.has(nome)) return j({ ok: false, erro: 'sabor desconhecido' }, 400);
  const agora = new Date().toISOString();

  if (b.quantidade !== undefined) {
    await env.DB.prepare('UPDATE stock_salgadas SET quantidade = ?, atualizado_em = ? WHERE nome = ?')
      .bind(Math.max(0, parseInt(b.quantidade, 10) || 0), agora, nome).run();
  }
  if (b.minimo !== undefined) {
    await env.DB.prepare('UPDATE stock_salgadas SET minimo = ?, atualizado_em = ? WHERE nome = ?')
      .bind(Math.max(0, parseInt(b.minimo, 10) || 0), agora, nome).run();
  }
  return await listarSalgadas(request, env);
}

async function listarDoces(request, env) {
  const r = await env.DB.prepare(
    'SELECT quantidade, minimo, atualizado_em FROM stock_doces WHERE id = 1'
  ).first();
  return j({ ok: true, doces: r || { quantidade: 0, minimo: 0 } });
}

async function mudarDoceStock(request, env) {
  let b;
  try { b = await request.json(); } catch (e) { return j({ ok: false, erro: 'corpo invalido' }, 400); }
  const agora = new Date().toISOString();
  if (b.quantidade !== undefined) {
    await env.DB.prepare('UPDATE stock_doces SET quantidade = ?, atualizado_em = ? WHERE id = 1')
      .bind(Math.max(0, parseInt(b.quantidade, 10) || 0), agora).run();
  }
  if (b.minimo !== undefined) {
    await env.DB.prepare('UPDATE stock_doces SET minimo = ?, atualizado_em = ? WHERE id = 1')
      .bind(Math.max(0, parseInt(b.minimo, 10) || 0), agora).run();
  }
  return await listarDoces(request, env);
}

async function limparEnsaio(request, env) {
  // Devolve tudo o que os ensaios tinham consumido -- contador do dia,
  // salgadas, massa doce e bebidas/ofertas -- pedido a pedido, e so depois
  // apaga os pedidos. Sem isto, um ensaio deixava o stock permanentemente
  // mais baixo mesmo depois de "apagado".
  const agora = new Date().toISOString();
  const { results: debitados } = await env.DB.prepare(
    `SELECT dia, n_esfihas, itens FROM pedidos WHERE ensaio = 1 AND stock_debitado = 1`
  ).all();

  const lote = [];
  const porDia = {};
  for (const r of debitados || []) {
    porDia[r.dia] = (porDia[r.dia] || 0) + (r.n_esfihas || 0);
    for (const x of producaoDoItens(r.itens)) {
      const n = parseInt(x.n, 10) || 0;
      if (!n) continue;
      if (x.doce) {
        lote.push(env.DB.prepare(
          `UPDATE stock_doces SET quantidade = MAX(0, quantidade + ?), atualizado_em = ? WHERE id = 1`
        ).bind(n, agora));
      } else if (x.sabor) {
        lote.push(env.DB.prepare(
          `UPDATE stock_salgadas SET quantidade = MAX(0, quantidade + ?), atualizado_em = ? WHERE nome = ?`
        ).bind(n, agora, x.sabor));
      }
    }
    for (const beb of bebidasDoItens(r.itens)) {
      if (ehOfertaOpaca(beb.nome)) continue;
      const nome = nomeBaseBebida(beb.nome);
      const n = parseInt(beb.n, 10) || 0;
      if (!nome || !n) continue;
      lote.push(env.DB.prepare(
        `UPDATE stock_bebidas SET quantidade = MAX(0, quantidade + ?), atualizado_em = ? WHERE nome = ?`
      ).bind(n, agora, nome));
    }
    lote.push(env.DB.prepare(
      `UPDATE stock_bebidas SET quantidade = MAX(0, quantidade + por_pedido), atualizado_em = ? WHERE por_pedido > 0`
    ).bind(agora));
  }
  for (const dia of Object.keys(porDia)) {
    lote.push(env.DB.prepare('UPDATE stock SET usado = MAX(0, usado - ?) WHERE dia = ?').bind(porDia[dia], dia));
  }
  lote.push(env.DB.prepare('DELETE FROM pedidos WHERE ensaio = 1'));
  if (lote.length) await env.DB.batch(lote);
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

  // Custo por produto (sabor, extra ou bebida) definido a mao no painel --
  // serve so para dar uma nocao de custo/lucro, nao e contabilidade real.
  const { results: custosRows } = await env.DB.prepare('SELECT produto, custo_cent FROM custos').all();
  const custos = {};
  for (const c of custosRows || []) custos[c.produto] = c.custo_cent || 0;

  const { results: stockBebidas } = await env.DB.prepare(
    'SELECT nome, quantidade, minimo, por_pedido FROM stock_bebidas ORDER BY por_pedido DESC, nome ASC'
  ).all();

  const somar = (o, k, n) => { if (k) o[k] = (o[k] || 0) + n; };
  const dias = {}, horas = {}, zonas = {}, origens = {};
  const sabores = {}, extras = {}, bebidas = {}, bebidasVendidas = {}, bebidasOfertas = {};
  let receita = 0, esfihas = 0, entregas = 0, receitaEntregas = 0;
  let custoProdutos = 0, entregaCobrada = 0, entregaCustoUber = 0;

  for (const r of linhas || []) {
    receita += r.total_cent || 0;
    esfihas += r.n_esfihas || 0;
    if (r.modo === 'entrega') { entregas++; receitaEntregas += r.total_cent || 0; }

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
        custoProdutos += (custos[x.sabor] || 0) * (x.n || 0);
        for (const e of x.extras || []) {
          somar(extras, e, x.n || 0);
          custoProdutos += (custos[e] || 0) * (x.n || 0);
        }
      }
      for (const b of it.bebidas || []) {
        somar(bebidas, b.nome, b.n || 0);
        custoProdutos += (custos[b.nome] || 0) * (b.n || 0);
        if (ehOfertaOpaca(b.nome)) {
          somar(bebidasOfertas, b.nome, b.n || 0);
        } else {
          const alvo = ehGratis(b.nome) ? bebidasOfertas : bebidasVendidas;
          somar(alvo, nomeBaseBebida(b.nome), b.n || 0);
        }
      }
      if (it.entrega) {
        entregaCobrada += it.entrega.cent || 0;
        entregaCustoUber += it.entrega.custo_cent || 0;
      }
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

  // Ofertas fixas (ex.: saquetas de ketchup): nao vem no itens de nenhum
  // pedido, sai sempre a mesma quantidade por pedido -- calcula-se por fora.
  const ofertasFixas = (stockBebidas || [])
    .filter(x => x.por_pedido > 0)
    .map(x => ({ nome: x.nome, n: x.por_pedido * pedidos }));

  return j({
    ok: true, de, ate,
    resumo: { pedidos, receita, esfihas, entregas, receitaEntregas, retiradas: pedidos - entregas, medio: pedidos ? receita / pedidos : 0 },
    porDia: serie,
    porHora: valores(horas).sort((a, b) => a.hora - b.hora),
    porZona: valores(zonas).sort((a, b) => b.pedidos - a.pedidos),
    porOrigem: valores(origens).sort((a, b) => b.pedidos - a.pedidos),
    visitas: vis || [],
    sabores: ordenar(sabores), extras: ordenar(extras), bebidas: ordenar(bebidas),
    bebidasVendidas: ordenar(bebidasVendidas), bebidasOfertas: ordenar(bebidasOfertas), ofertasFixas,
    stockBebidas: stockBebidas || [],
    // Fecho de caixa: so aparece com nocao real quando os custos estiverem
    // preenchidos no painel -- ate la fica tudo a 0 (nunca inventa valores).
    custoProdutos, entregaCobrada, entregaCustoUber,
    lucroEstimado: receita - custoProdutos - entregaCustoUber,
  });
}

async function listarCustos(env) {
  const { results } = await env.DB.prepare('SELECT produto, custo_cent FROM custos ORDER BY produto').all();
  return j({ ok: true, custos: results || [] });
}

async function guardarCustos(request, env) {
  let b;
  try { b = await request.json(); } catch (e) { return j({ ok: false, erro: 'corpo invalido' }, 400); }
  const itens = Array.isArray(b.itens) ? b.itens : [];
  const lote = itens
    .filter(it => it && it.produto)
    .map(it => env.DB.prepare(
      `INSERT INTO custos (produto, custo_cent) VALUES (?, ?)
       ON CONFLICT(produto) DO UPDATE SET custo_cent = excluded.custo_cent`
    ).bind(limpar(it.produto, 120), Math.max(0, parseInt(it.custo_cent, 10) || 0)));
  if (lote.length) await env.DB.batch(lote);
  return await listarCustos(env);
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
      if (p === '/api/stock-bebidas' && request.method === 'GET') {
        return await stockPublicoBebidas(request, env);
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
        if (p === '/api/painel/custos' && request.method === 'GET') return await listarCustos(env);
        if (p === '/api/painel/custos' && request.method === 'POST') return await guardarCustos(request, env);
        if (p === '/api/painel/bebidas' && request.method === 'GET') return await listarBebidas(request, env);
        if (p === '/api/painel/bebidas' && request.method === 'POST') return await mudarBebidaStock(request, env);
        if (p === '/api/painel/salgadas-stock' && request.method === 'GET') return await listarSalgadas(request, env);
        if (p === '/api/painel/salgadas-stock' && request.method === 'POST') return await mudarSalgadaStock(request, env);
        if (p === '/api/painel/doces-stock' && request.method === 'GET') return await listarDoces(request, env);
        if (p === '/api/painel/doces-stock' && request.method === 'POST') return await mudarDoceStock(request, env);
        if (p === '/api/painel/subscrever' && request.method === 'POST') return await subscrever(request, env);
        if (p === '/api/painel/testar-aviso' && request.method === 'POST') return await testarAviso(request, env, ctx);
        if (p === '/api/painel/uber-entrega' && request.method === 'POST') return await criarEntregaUberReal(request, env);
        if (p === '/api/painel/uber-cancelar' && request.method === 'POST') return await cancelarEntregaUber(request, env);
        if (p === '/api/painel/chave' && request.method === 'GET') return j({ ok: true, chave: VAPID_PUBLIC });
      }

      return j({ ok: false, erro: 'nao existe' }, 404);
    } catch (e) {
      return j({ ok: false, erro: 'falha no servidor', detalhe: String(e && e.message || e) }, 500);
    }
  },
};
