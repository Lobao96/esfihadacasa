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

// Horario automatico da loja -- tem de ficar sempre igual ao HOURS em
// public/index.html e public/teste/index.html (se mudares o horario, muda
// aqui tambem). Usado para saber se a loja deve estar aberta AGORA quando
// nao ha nenhum override manual ativo para o dia (ver estadoDoDia mais
// abaixo) -- e o que garante que um "abrir manualmente" de uma segunda-feira
// nunca fica pendurado para os dias seguintes: cada dia novo (linha nova na
// tabela stock) comeca sem override, e por isso segue logo este horario.
// day: 0=domingo .. 6=sabado (mesma convencao do Date.getDay()).
const HORARIO_AUTOMATICO = [
  { day: 0, shifts: [{ open: '12:00', close: '15:30' }, { open: '18:30', close: '22:00' }] }, // Domingo
  { day: 1, shifts: [] }, // Segunda - fechado
  { day: 2, shifts: [] }, // Terca - fechado
  { day: 3, shifts: [] }, // Quarta - fechado
  { day: 4, shifts: [] }, // Quinta - fechado
  { day: 5, shifts: [{ open: '19:30', close: '23:59' }] }, // Sexta (ate 00h)
  { day: 6, shifts: [{ open: '12:00', close: '15:30' }, { open: '18:30', close: '23:59' }] }, // Sabado (ate 00h)
];

function horaMinutoLisboa(d = new Date()) {
  const partes = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Lisbon', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d);
  const h = Number((partes.find(p => p.type === 'hour') || {}).value || 0);
  const m = Number((partes.find(p => p.type === 'minute') || {}).value || 0);
  return h * 60 + m;
}

function estaAbertoAutomatico(agora = new Date()) {
  const dia = diaLisboa(agora);
  // Dia da semana a partir da data (texto AAAA-MM-DD) em vez da hora atual,
  // para nao depender do fuso do runtime -- o dia-da-semana de uma data e
  // sempre o mesmo, seja a que horas for.
  const diaSemana = new Date(dia + 'T00:00:00Z').getUTCDay();
  const horario = HORARIO_AUTOMATICO.find(h => h.day === diaSemana);
  if (!horario || !horario.shifts.length) return false;
  const agoraMin = horaMinutoLisboa(agora);
  return horario.shifts.some(s => {
    const [oh, om] = s.open.split(':').map(Number);
    const [ch, cm] = s.close.split(':').map(Number);
    return agoraMin >= (oh * 60 + om) && agoraMin <= (ch * 60 + cm);
  });
}

// Converte um dia (AAAA-MM-DD) e hora (HH:MM) DE LISBOA no instante UTC
// correspondente -- preciso para calcular a expiracao do override (ver
// expiraOverride mais abaixo). Tem de lidar com o deslize de fuso (Lisboa
// esta a UTC+0 ou UTC+1 segundo a epoca do ano) e com a mudanca de dia
// civil entre UTC e Lisboa perto da meia-noite.
function instanteLisboa(diaStr, horaStr) {
  const palpite = new Date(`${diaStr}T${horaStr}:00Z`);
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Lisbon', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(palpite);
  const obj = {};
  for (const p of partes) obj[p.type] = p.value;
  const comoUTC = Date.UTC(
    Number(obj.year), Number(obj.month) - 1, Number(obj.day),
    Number(obj.hour), Number(obj.minute), Number(obj.second)
  );
  const desvio = comoUTC - palpite.getTime();
  return new Date(palpite.getTime() - desvio);
}

// Proxima vez (depois de "agora") em que o horario automatico abre ou
// fecha a loja -- e quando um override manual deve deixar de valer (ver
// comentario em expiraOverride).
function proximaTransicaoAutomatica(agora) {
  for (let i = 0; i < 9; i++) {
    const data = new Date(agora.getTime() + i * 86400000);
    const diaStr = diaLisboa(data);
    const diaSemana = new Date(diaStr + 'T00:00:00Z').getUTCDay();
    const horario = HORARIO_AUTOMATICO.find(h => h.day === diaSemana);
    const shifts = (horario && horario.shifts) || [];
    const candidatos = [];
    for (const s of shifts) { candidatos.push(s.open); candidatos.push(s.close); }
    for (const horaStr of candidatos.sort()) {
      const instante = instanteLisboa(diaStr, horaStr);
      if (instante.getTime() > agora.getTime()) return instante;
    }
  }
  // Nunca deveria chegar aqui (ha sempre um turno nos proximos 9 dias),
  // mas por seguranca devolve algo no futuro em vez de travar.
  return new Date(agora.getTime() + 9 * 86400000);
}

// Meia-noite de Lisboa seguinte a "agora" -- limite de seguranca para a
// expiracao do override, para nunca ficar pendurado de um dia para o outro
// mesmo em semanas sem mais nenhum turno automatico (ex.: segunda-feira).
function meiaNoiteSeguinte(agora) {
  const amanha = new Date(agora.getTime() + 86400000);
  const amanhaStr = diaLisboa(amanha);
  return instanteLisboa(amanhaStr, '00:00');
}

// Quando um override manual (forcar abrir/fechar no painel) deixa de
// valer: na proxima transicao automatica (abrir ou fechar, o que vier
// primeiro) -- ou a meia-noite seguinte, se isso vier primeiro (ex.: numa
// segunda-feira, sem mais nenhum turno essa semana). A partir desse
// instante a loja volta a seguir o horario automatico sozinha.
function expiraOverride(agora) {
  return new Date(Math.min(
    proximaTransicaoAutomatica(agora).getTime(),
    meiaNoiteSeguinte(agora).getTime()
  ));
}

// Valores padrao reais do frigorifico/congelador, usados pelo
// preenchimento automatico diario do registo de temperaturas (pedido
// pelo Miguel em 2026-11-01 -- ver preencherTemperaturaPadrao, chamado
// no scheduled()). Se os valores reais mudarem, atualizar aqui.
const TEMP_PADRAO_FRIGORIFICO_C = 4;
const TEMP_PADRAO_CONGELADOR_C = -18;

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
  let r = await db.prepare('SELECT total, usado, aberto, override_expira FROM stock WHERE dia = ?').bind(dia).first();
  if (!r) {
    // override_expira = NULL -- um dia novo nasce sempre a seguir o
    // horario automatico, nunca "aberto por defeito" como acontecia antes.
    // So fica forcado (aberto ou fechado) quando o dono usa o botao no
    // painel, e mesmo assim so ate a proxima transicao automatica ou a
    // meia-noite seguinte, o que vier primeiro (ver expiraOverride).
    await db.prepare('INSERT OR IGNORE INTO stock (dia, total, usado, aberto, override_expira) VALUES (?, 0, 0, 1, NULL)').bind(dia).run();
    r = { total: 0, usado: 0, aberto: 1, override_expira: null };
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
  // automatico: o que o horario semanal diz AGORA, sem nenhum override.
  // overrideAtivo: se o dono forcou um valor diferente do automatico (nos
  // dois sentidos -- abrir fora de horas ou fechar dentro de horas) e esse
  // forcar ainda nao expirou. Sem override ativo, o automatico manda
  // sempre; com override ativo, o override manda -- ate a proxima
  // transicao automatica (abrir ou fechar) ou a meia-noite seguinte, o que
  // vier primeiro (ver expiraOverride), altura em que volta a seguir o
  // automatico sozinho, sem precisar de nenhuma acao do dono.
  const agora = new Date();
  const automatico = estaAbertoAutomatico(agora);
  const overrideAtivo = !!(r.override_expira && new Date(r.override_expira).getTime() > agora.getTime());
  const abertoManual = overrideAtivo ? !!r.aberto : automatico;
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
    automatico,
    overrideAtivo,
    overrideExpira: overrideAtivo ? r.override_expira : null,
    // abertoManual (nome mantido por compatibilidade com o painel) e o
    // estado "deveria estar aberta" antes de olhar ao stock -- automatico,
    // exceto com override ativo hoje. aberto e o estado real que bloqueia
    // pedidos: so fica aberto se abertoManual E ainda houver stock.
    abertoManual,
    aberto: abertoManual && restante > 0,
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
// Le "Oferta Nx bebida em lata (a escolha da casa)" / "...de 1L..." e devolve
// { n, tipo } ('lata' ou 'litro'). resolverOfertaBebida() usa o tipo para
// saber quantas escolhas pedir e que garrafas aceitar -- o nome real em
// stock_bebidas NAO tem prefixo "Lata"/"Garrafa 1 litro" (ex.: "Coca-Cola",
// "Coca-Cola 1L"), distingue-se so pelo sufixo "1L" no nome.
function parseOfertaOpaca(nome) {
  const m = /^Oferta\s+(\d+)x\s+bebida\s+(em lata|de 1L)/i.exec(String(nome || '').trim());
  if (!m) return null;
  const n = parseInt(m[1], 10) || 0;
  if (!n) return null;
  const tipo = /lata/i.test(m[2]) ? 'lata' : 'litro';
  return { n, tipo };
}
function ehBebida1L(nome) {
  return /1\s*l\b/i.test(String(nome || ''));
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
// (10/10) A entrega passou a ser feita por um estafeta proprio (primeiro
// a Andreza; a partir de 23/10 o proprio Miguel), nao pelo estafeta da
// Uber -- ver mudarPedido()/painel. A chamada ao Uber aqui em baixo
// (cotarEntrega) fica so como *estimativa de distancia* para decidir se a
// morada fica dentro da area cobrada, nunca para despachar de verdade. A
// pedido do dono, deixou de haver faixas por zona: entrega a 3,50€ fixos
// para toda a area aprovada (Alvor a Parchal, sem Lagoa Centro).
//
// (10/10, mais tarde) Tentou-se cortar a zona pelo TEMPO em vez do custo,
// mas voltou a dar asneira em producao: testado ao vivo, ate o Parchal (a
// 5min, zona ja confirmada varias vezes) foi recusado com o corte em
// 15min E em 20min -- confirma de vez a nota antiga mais abaixo: o campo
// "duration" da Uber tem SEMPRE um piso de ~40min, mesmo a distancia zero,
// e nunca reflete o tempo real. Nunca mais usar "duration" como corte de
// zona. O estafeta faz agora TODAS as entregas a tempo inteiro -- o site ja
// nao pergunta a Uber coisa nenhuma (nem para decidir a zona nem para
// pedir o estafeta). A decisao e 100% local, sem chamadas de rede, baseada
// na morada que o cliente escreveu: codigo postal (concelho) + localidade
// (texto, vindo do Google Places -- ex.: "Lagoa", "Porches", "Parchal").
//
// Porque nao basta o codigo postal: o concelho de Lagoa (prefixo 8400)
// cobre tanto Lagoa Centro como Porches e Carvoeiro, que ficam bem mais
// longe. E os codigos postais NAO estao arrumados por zona dentro do
// concelho -- confirmado via CTT (codigo-postal.pt): ruas de Porches
// (8400-997, 8400-481, 8400-466, 8400-479) e de Lagoa Centro (8400-397,
// 8400-448) misturam-se na mesma gama numerica. Por isso o codigo postal
// so serve para confirmar o CONCELHO certo; quem decide a zona fina de
// verdade e o nome da localidade.
//
// Taxa fixa de entrega: 3,50€, sempre, para qualquer morada dentro da
// zona aprovada (sem Uber nem variacao por distancia).
const ENTREGA_FIXA_CENT = 350;

// Promocao pontual: entrega gratis so no dia de Halloween (31/10/2026),
// decidido pelo Miguel em 2026-10-31. Reverte automaticamente no dia
// seguinte (nao fica a funcionar para sempre) -- so compara a data de
// Lisboa de hoje, sem flag manual para desligar depois.
function ehPromoEntregaGratisHoje() {
  return diaLisboa() === '2026-10-31';
}
function taxaEntregaAtual() {
  return ehPromoEntregaGratisHoje() ? 0 : ENTREGA_FIXA_CENT;
}

const CONCELHOS_ENTREGA = new Set(['8400', '8500']); // Lagoa, Portimao

function codigoPostalSeguro(cp) {
  const m = (cp || '').trim().match(/^(\d{4})-?(\d{3})$/);
  if (!m) return false;
  return CONCELHOS_ENTREGA.has(m[1]);
}

// Localidades aceites para entrega, dos concelhos de Portimao e Lagoa, ate
// ao limite confirmado pelo dono (max. Parchal -- Lagoa Centro deixou de
// ser aceite a partir de 23/10; nunca Porches nem Carvoeiro, que ficam
// "muito longe").
// Comparacao sem acentos/maiusculas para aceitar "Lagôa", "PARCHAL", etc.
const LOCALIDADES_ACEITES = [
  'portimao', 'praia da rocha', 'alvor', 'mexilhoeira grande', // concelho de Portimao
  'parchal', 'ferragudo', 'estombar', // concelho de Lagoa, ate ao limite confirmado (sem Lagoa Centro)
];
// Fora de alcance mesmo tendo codigo postal 8400 (confirmado pelo dono, 23/10:
// Lagoa Centro deixou de ser aceite -- Porches/Carvoeiro continuam "muito longe").
const LOCALIDADES_FORA = ['porches', 'carvoeiro', 'lagoa'];

function semAcentos(s) {
  return (s || '').toString().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

// Decide so pela localidade (texto) escrita/escolhida pelo cliente.
// Devolve true/false, ou null se a localidade estiver vazia ou nao for
// reconhecida (nesse caso cai-se so no codigo postal, ver cotacao()).
function localidadeSegura(localidade) {
  const loc = semAcentos(localidade);
  if (!loc) return null;
  if (LOCALIDADES_FORA.some(f => loc.includes(f))) return false;
  if (LOCALIDADES_ACEITES.some(a => loc.includes(a))) return true;
  return null;
}

async function cotacao(request, env) {
  let b;
  try { b = await request.json(); } catch (e) { return j({ ok: false, erro: 'corpo invalido' }, 400); }

  const rua = limpar(b.morada, 200);
  if (!rua || rua.length < 5) return j({ ok: false, erro: 'morada curta' }, 400);
  const cp = limpar(b.codigo_postal, 12) || '';
  const localidade = limpar(b.localidade, 60) || '';

  // 1) Codigo postal, se houver, tem de ser do concelho certo -- corta
  //    logo Lagos/Silves/Monchique/etc., sem depender da localidade.
  if (cp && !codigoPostalSeguro(cp)) {
    return j({ ok: false, erro: 'fora_de_alcance', motivo: 'fora_do_concelho' }, 200);
  }

  // 2) A localidade decide a zona fina (Lagoa/Parchal sim, Porches/
  //    Carvoeiro nao), mesmo dentro do mesmo codigo postal 8400.
  const okLocalidade = localidadeSegura(localidade);
  if (okLocalidade === false) {
    return j({ ok: false, erro: 'fora_de_alcance', motivo: 'fora_da_zona' }, 200);
  }
  if (okLocalidade === true) {
    return j({ ok: true, fee_cent: taxaEntregaAtual() });
  }

  // 3) Localidade vazia ou nao reconhecida: cai-se so no codigo postal
  //    (concelho certo) como rede de seguranca -- mesma logica de sempre.
  if (codigoPostalSeguro(cp)) {
    return j({ ok: true, fee_cent: taxaEntregaAtual() });
  }
  return j({ ok: false, erro: 'fora_de_alcance', motivo: 'sem_zona_confirmada' }, 200);
}

// ---------------------------------------------------------------- pedidos

// ---------------------------------------------------------------------------
// Novidades "secretas": sabores novos guardados na base de dados (nao no
// codigo, que e publico) e que so aparecem no site a partir de `publica_em`.
// Antes dessa hora so quem tem a palavra-passe do painel os ve (pre-visualizacao)
// e o servidor recusa pedidos que os incluam.
// ---------------------------------------------------------------------------
let novidadesOk = false;
async function garantirNovidades(env) {
  if (novidadesOk) return;
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS novidades (
       id TEXT PRIMARY KEY, nome TEXT NOT NULL, descricao TEXT, ingredientes TEXT, alergenios TEXT,
       preco_cent INTEGER NOT NULL, img_data TEXT, publica_em TEXT NOT NULL, doce INTEGER NOT NULL DEFAULT 1)`
  ).run();
  novidadesOk = true;
}

async function novidadesPublicas(request, env) {
  try {
    await garantirNovidades(env);
    const previa = autorizado(request, env);
    const agora = new Date().toISOString();
    const { results } = await env.DB.prepare(
      previa ? 'SELECT * FROM novidades ORDER BY publica_em ASC'
             : 'SELECT * FROM novidades WHERE publica_em <= ? ORDER BY publica_em ASC'
    ).bind(...(previa ? [] : [agora])).all();
    const novidades = (results || []).map(r => {
      let alerg = [];
      try { alerg = JSON.parse(r.alergenios || '[]'); } catch (e) {}
      return { id: r.id, name: r.nome, desc: r.descricao || '', ing: r.ingredientes || '', alerg,
               price: (r.preco_cent || 0) / 100, img: r.img_data || '', doce: r.doce ? 1 : 0,
               previa: r.publica_em > agora ? 1 : 0 };
    });
    return new Response(JSON.stringify({ ok: true, novidades }), {
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    });
  } catch (e) {
    return j({ ok: true, novidades: [] });
  }
}

// Nomes das novidades ainda por publicar (para recusar pedidos que as incluam).
async function nomesNovidadesOcultas(env) {
  try {
    await garantirNovidades(env);
    const { results } = await env.DB.prepare('SELECT nome FROM novidades WHERE publica_em > ?')
      .bind(new Date().toISOString()).all();
    return (results || []).map(r => r.nome);
  } catch (e) { return []; }
}

async function novoPedido(request, env, ctx) {
  let b;
  try { b = await request.json(); } catch (e) { return j({ ok: false, erro: 'corpo invalido' }, 400); }

  const dia = diaLisboa();
  const ensaio = b.ensaio ? 1 : 0;
  // Miguel decidiu em 2026-10-24: o site de ensaio (/teste/) nao vai ser
  // usado por agora, por isso o servidor deixa de aceitar pedidos de ensaio
  // (mesmo que alguem ainda consiga abrir uma copia antiga da pagina).
  if (ensaio) {
    return j({ ok: false, erro: 'ensaio_desativado' }, 409);
  }
  {
    const ocultas = await nomesNovidadesOcultas(env);
    if (ocultas.length) {
      const prod = (b.itens && typeof b.itens === 'object' && Array.isArray(b.itens.producao)) ? b.itens.producao : [];
      if (prod.some(x => x && ocultas.includes(x.sabor))) return j({ ok: false, erro: 'indisponivel' }, 409);
    }
  }
  const st = await estadoDoDia(env.DB, dia);
  if (!ensaio && !st.aberto) {
    return j({ ok: false, erro: 'esgotado', estado: st }, 409);
  }
  // O numero de esfihas usado em TODO o resto desta funcao (stock, piso de
  // preco) vem sempre de itens.producao, nunca do n_esfihas que o cliente
  // manda a parte -- caso contrario bastava mandar itens reais com
  // n_esfihas: 0 para fugir ao check de stock agregado e ao piso de preco
  // mais abaixo. gratisReal conta so as esfihas marcadas como oferta
  // (brinde automatico de 10+ esfihas) -- essas continuam a gastar stock,
  // mas nao entram no preco minimo exigido.
  const producaoRecebida = (b.itens && typeof b.itens === 'object' && !Array.isArray(b.itens) && Array.isArray(b.itens.producao)) ? b.itens.producao : [];
  let nEsfihasReal = 0, nEsfihasGratisReal = 0;
  for (const x of producaoRecebida) {
    const n = Math.max(0, parseInt(x && x.n, 10) || 0);
    const g = Math.min(n, Math.max(0, parseInt(x && x.gratis, 10) || 0));
    nEsfihasReal += n;
    nEsfihasGratisReal += g;
  }
  const nEsfihasPedidas = nEsfihasReal;
  // O unico desconto legitimo de esfihas "gratis" na producao e a
  // promocao automatica do dia de inauguracao (3 avulsas compra +2
  // gratis, 6+ compra +4 gratis), que so existe no proprio dia
  // 2026-10-11 (o site so mostra essa opcao nesse dia). Fora desse dia,
  // qualquer esfiha marcada "gratis" na producao e sinal de um pedido
  // manipulado (campo nunca validado antes).
  if (!ensaio && nEsfihasGratisReal > 0 && dia !== '2026-10-11') {
    return j({ ok: false, erro: 'gratis_invalido' }, 400);
  }
  // Bebidas reais pagas (exclui brinde automatico "(gratis)" e as
  // "Oferta Nx bebida..." de combos, ja cobertas pelo preco fixo do
  // combo) -- usado mais abaixo no piso de preco, para fechar o buraco
  // de um pedido so de bebidas poder ir com total_cent a 0.
  const bebidasRecebidas = (b.itens && typeof b.itens === 'object' && !Array.isArray(b.itens) && Array.isArray(b.itens.bebidas)) ? b.itens.bebidas : [];
  let nBebidasPagasReal = 0;
  for (const beb of bebidasRecebidas) {
    const nome = beb && beb.nome;
    if (ehGratis(nome) || ehOfertaOpaca(nome)) continue;
    nBebidasPagasReal += Math.max(0, parseInt(beb && beb.n, 10) || 0);
  }

  // Mesmo com a loja aberta, um pedido individual pode pedir mais esfihas do
  // que o stock que resta (ex: restam 10 e o pedido tem um combo de 20).
  // Isso tem de ser travado aqui, nao so quando o stock geral chega a zero.
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
  const itensObj = (b.itens && typeof b.itens === 'object') ? b.itens : [];
  // Observacao livre da encomenda (uma so, nao por esfiha) -- texto do
  // cliente, por isso limitada aqui tambem (nunca confiar so no limite do
  // browser) antes de ir para a base de dados e, depois, para o HTML do
  // painel.
  if (itensObj && !Array.isArray(itensObj) && itensObj.observacao != null) {
    const obsLimpa = limpar(itensObj.observacao, 300).replace(/\s*[\r\n]+\s*/g, ' ').trim();
    if (obsLimpa) itensObj.observacao = obsLimpa; else delete itensObj.observacao;
  }
  // Codigo promocional (ex.: premio de sorteio) -- e um DESCONTO fixo em
  // centimos (nunca o pedido inteiro gratis), para cobrir so o premio
  // exacto (ex.: as 3 esfihas + 1 bebida do combo) -- qualquer coisa a mais
  // no pedido (extras, mais itens) continua a ser cobrada normalmente.
  // Sempre uso unico. So valida aqui; o consumo (marcar usado) so acontece
  // depois do pedido ser mesmo criado, mais abaixo, para nunca gastar um
  // codigo num pedido que falhou a criar por outro motivo.
  let promoAplicado = null;
  const codigoPromoBruto = limpar(b.codigoPromo, 40);
  if (codigoPromoBruto && codigoPromoBruto.trim()) {
    const codigoPromo = codigoPromoBruto.trim().toUpperCase();
    await garantirFidelidade(env);
    const linhaPromo = await env.DB.prepare('SELECT * FROM codigos_promo WHERE codigo = ?').bind(codigoPromo).first();
    if (!linhaPromo) return j({ ok: false, erro: 'promo_invalido' }, 400);
    // Codigo de fidelidade: so vale para o telefone a que foi dado.
    if (linhaPromo.tipo === 'fidelidade' && chaveTelefone(telCliente) !== linhaPromo.telefone) {
      return j({ ok: false, erro: 'promo_telefone' }, 400);
    }
    if ((linhaPromo.usos_contagem || 0) >= (linhaPromo.usos_max || 1)) return j({ ok: false, erro: 'promo_usado' }, 400);
    if ((linhaPromo.min_esfihas || 0) > 0 && nEsfihasReal < linhaPromo.min_esfihas) {
      return j({ ok: false, erro: 'promo_minimo_esfihas', min_esfihas: linhaPromo.min_esfihas }, 400);
    }
    // Um codigo promocional nunca acumula com o brinde automatico (10+
    // esfihas -> bebida gratis): se vier alguma bebida marcada "(gratis)"
    // num pedido com codigo aplicado, rejeita -- o site ja nao deixa
    // escolher as duas coisas ao mesmo tempo, isto e so a rede de segurança.
    if (bebidasRecebidas.some(x => ehGratis(x && x.nome))) {
      return j({ ok: false, erro: 'promo_nao_acumula_brinde' }, 400);
    }
    // Um codigo promocional tambem nunca acumula com combos -- ja tem preco
    // fixo e bebidas incluidas. O site ja nao deixa aplicar o codigo com um
    // combo no carrinho, isto e so a rede de segurança: toda linha de combo
    // comeca sempre por "Combo " (nome do catalogo em COMBOS).
    const linhasRecebidas = (b.itens && typeof b.itens === 'object' && !Array.isArray(b.itens) && Array.isArray(b.itens.linhas)) ? b.itens.linhas : [];
    // Excecao: certos codigos (PROMO_COMBO_PERMITIDO) foram feitos de
    // proposito para um combo especifico (ex.: premio de sorteio = Combo
    // individual) e so esse combo e aceite com eles.
    // Codigos tipo 'toda' valem para a encomenda toda, combos incluidos.
    const combosPermitidos = (PROMO_COMBO_PERMITIDO[codigoPromo] || []).map(x => x.toLowerCase());
    if (linhaPromo.tipo !== 'toda' && linhasRecebidas.some(l => {
      const t = String(l || '').trim();
      if (!/^Combo\s/i.test(t)) return false;
      return !combosPermitidos.some(n => t.toLowerCase().startsWith(n));
    })) {
      return j({ ok: false, erro: 'promo_nao_acumula_combo' }, 400);
    }
    promoAplicado = linhaPromo;
  }
  // Piso de preco (minimo plausivel, nao o preco exato): o total enviado
  // pelo browser tem de cobrir, no minimo, as esfihas REALMENTE pagas
  // (exclui as marcadas como oferta/brinde) a 1,50€ cada -- bem abaixo do
  // preco mais barato real (2,40€/esfiha no maior combo), para nunca
  // rejeitar por engano um pedido legitimo com combos/extras/promocoes.
  // So fecha o buraco de um total manipulado no cliente para ficar abaixo
  // do que os itens reais custam (ex.: mandar itens.producao reais com
  // total_cent: 1). Isto REJEITA o pedido (antes so avisava, sem travar).
  // Este piso aplica-se sempre ao total ORIGINAL (antes do desconto do
  // codigo promocional) -- o desconto nunca serve para disfarçar um total
  // manipulado nos itens reais.
  const PRECO_MINIMO_PLAUSIVEL_CENT = 150;
  // 1,50€ e tambem o preco real da bebida mais barata (Agua) -- mesmo
  // raciocinio conservador do piso das esfihas, nunca rejeita um pedido
  // legitimo so por causa das bebidas.
  const PRECO_MINIMO_PLAUSIVEL_BEBIDA_CENT = 150;
  const totalOriginalCent = Math.max(0, parseInt(b.total_cent, 10) || 0);
  const nEsfihasPagasReal = Math.max(0, nEsfihasReal - nEsfihasGratisReal);
  const temItemPagoReal = nEsfihasPagasReal > 0 || nBebidasPagasReal > 0;
  const pisoCent = nEsfihasPagasReal * PRECO_MINIMO_PLAUSIVEL_CENT
    + nBebidasPagasReal * PRECO_MINIMO_PLAUSIVEL_BEBIDA_CENT
    + (!ensaio && b.modo === 'entrega' && temItemPagoReal ? taxaEntregaAtual() : 0);
  if (!ensaio && pisoCent > 0 && totalOriginalCent < pisoCent) {
    return j({ ok: false, erro: 'total_invalido' }, 400);
  }
  const baseItensPromoCent = baseItensDoPedido(b, totalOriginalCent);
  const descontoPromoCent = promoAplicado ? (calcularDescontoPromo(promoAplicado, totalOriginalCent, nEsfihasReal, baseItensPromoCent) || 0) : 0;
  const totalEnviadoCent = totalOriginalCent - descontoPromoCent;
  if (promoAplicado && itensObj && !Array.isArray(itensObj)) {
    if (!Array.isArray(itensObj.linhas)) itensObj.linhas = [];
    const descontoTxt = (descontoPromoCent / 100).toFixed(2).replace('.', ',') + '€';
    itensObj.linhas.push(`🎁 Código promocional aplicado: ${promoAplicado.codigo} — desconto de ${descontoTxt}`);
  }
  if (itensObj && !Array.isArray(itensObj)) {
    itensObj.pagas_original = nEsfihasPagasReal;
  }
  const itens = JSON.stringify(itensObj);
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
    limpar(b.morada, 300), totalEnviadoCent,
    nEsfihasReal, itens, limpar(b.mensagem, 4000), agora,
    token, telCliente, limpar(b.origem, 60), limpar(b.campanha, 80), nomeCliente,
    ...(ensaio ? [dia] : [])
  ).first();

  // Consome o codigo promocional so agora que o pedido foi mesmo criado --
  // o "WHERE usado = 0" evita gastar duas vezes o mesmo codigo em pedidos
  // simultaneos. So marca o pedido como ja pago se o desconto cobriu tudo;
  // se sobrou algo a pagar (extras, mais itens), segue o fluxo normal de
  // pagamento (MB Way/dinheiro) para esse valor.
  if (promoAplicado) {
    // Incrementa a contagem de usos; so marca "usado" (esgotado) quando a
    // contagem atinge o limite (usos_max). O "WHERE usos_contagem <
    // usos_max" evita passar do limite em pedidos simultaneos.
    const loteOpsPromo = [
      env.DB.prepare(
        `UPDATE codigos_promo
            SET usos_contagem = usos_contagem + 1,
                usado = CASE WHEN usos_contagem + 1 >= usos_max THEN 1 ELSE 0 END,
                usado_pedido_id = ?, usado_em = ?,
                desconto_usado_cent = COALESCE(desconto_usado_cent, 0) + ?
          WHERE codigo = ? AND usos_contagem < usos_max`
      ).bind(res.id, agora, descontoPromoCent, promoAplicado.codigo),
    ];
    if (totalEnviadoCent === 0) {
      loteOpsPromo.push(env.DB.prepare('UPDATE pedidos SET pago = 1 WHERE id = ?').bind(res.id));
    }
    await env.DB.batch(loteOpsPromo);
  }

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
  // Cartao de fidelidade do cliente (so dele: o link tem o codigo do pedido).
  let fidelidade = null;
  if (!p.ensaio) { try { fidelidade = await estadoFidelidade(env, p.telefone); } catch (e) {} }
  return j({ ok: true, pedido: p, fidelidade });
}

// Cria a entrega REAL no Uber Direct para um pedido (so entrega, nunca
// retirada). So e chamada quando o staff confirma explicitamente no
// painel -- nunca automaticamente. Pede sempre uma cotacao nova primeiro,
// porque a cotacao guardada no pedido pode ja ter expirado entre o
// cliente fazer o pedido e o staff carregar em "Comecar a fazer".
async function criarEntregaUberReal(request, env) {
  // (24/10) Desativado a pedido do dono: para ja, nada no site deve
  // ligar ao Uber -- as entregas sao feitas pelo proprio estafeta da
  // loja. Para reativar, remover este bloco.
  return j({ ok: false, erro: 'uber_desativado' }, 200);

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
  // (24/10) Desativado a pedido do dono: para ja, nada no site deve
  // ligar ao Uber. Para reativar, remover este bloco.
  return j({ ok: false, erro: 'uber_desativado' }, 200);

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
  // Vista mensal (Recibos): ?mes=AAAA-MM devolve os pedidos de todo o mes,
  // sem stock nem estado -- so o necessario para a tabela mensal.
  const mes = (url.searchParams.get('mes') || '').trim();
  if (/^\d{4}-\d{2}$/.test(mes)) {
    const { results } = await env.DB.prepare(
      `SELECT id, numero, dia, ensaio, estado, pago, modo, localidade, morada,
              total_cent, n_esfihas, itens, criado_em, telefone, nome
         FROM pedidos WHERE dia LIKE ? ORDER BY dia ASC, numero ASC`
    ).bind(mes + '-%').all();
    return j({ ok: true, mes, pedidos: results || [] });
  }
  const dia = url.searchParams.get('dia') || diaLisboa();
  const { results } = await env.DB.prepare(
    `SELECT id, dia, numero, senha, ensaio, estado, pago, modo, localidade, morada,
            total_cent, n_esfihas, itens, mensagem, criado_em, atualizado_em,
            token, telefone, nome, origem, motivo_cancelamento
       FROM pedidos WHERE dia = ? ORDER BY ensaio ASC, numero ASC`
  ).bind(dia).all();
  const { results: salgadas } = await env.DB.prepare(
    'SELECT nome, quantidade, minimo FROM stock_salgadas ORDER BY nome ASC'
  ).all();
  const doces = await env.DB.prepare(
    'SELECT quantidade, minimo FROM stock_doces WHERE id = 1'
  ).first();
  // Cartao de fidelidade: quantos pedidos entregues tem cada cliente do dia e
  // o codigo gerado por cada pedido (se este foi o 5.o, 10.o...). Nunca deve
  // impedir a lista de abrir.
  try {
    await garantirFidelidade(env);
    const { results: contagens } = await env.DB.prepare(
      `SELECT ${SQL_TEL_CHAVE} AS t, COUNT(*) AS n FROM pedidos
        WHERE ${SQL_CONTA_FIEL} AND telefone IS NOT NULL GROUP BY t`
    ).all();
    const porTel = {};
    (contagens || []).forEach(r => { if (r.t) porTel[r.t] = r.n; });
    const ids = (results || []).map(r => r.id);
    const codigos = {};
    if (ids.length) {
      const { results: cods } = await env.DB.prepare(
        `SELECT codigo, pedido_origem_id, usos_contagem, usos_max FROM codigos_promo
          WHERE tipo = 'fidelidade' AND pedido_origem_id IN (${ids.map(() => '?').join(',')})`
      ).bind(...ids).all();
      (cods || []).forEach(c => { codigos[c.pedido_origem_id] = c; });
    }
    (results || []).forEach(r => {
      const t = chaveTelefone(r.telefone);
      r.fiel_n = t ? (porTel[t] || 0) : 0;
      r.fiel_conta = pedidoContaFiel(r) ? 1 : 0;
      const c = codigos[r.id];
      if (c) { r.fiel_codigo = c.codigo; r.fiel_usado = (c.usos_contagem || 0) >= (c.usos_max || 1) ? 1 : 0; }
    });
  } catch (e) { /* sem fidelidade nesta resposta */ }
  return j({ ok: true, dia, pedidos: results, estado: await estadoDoDia(env.DB, dia),
             salgadas: salgadas || [], doces: doces || { quantidade: 0, minimo: 0 } });
}

const ESTADOS = ['novo', 'preparacao', 'pronto', 'caminho', 'entregue', 'cancelado'];

// Tabela de sabores/precos usada so para acrescentar itens a um pedido ja
// feito (ver adicionarItemPedido) -- espelha o MENU do site (public/index.html).
// Atualizar aqui tambem se os precos ou sabores mudarem la.
const SABORES = {
  trad:     { nome: 'A Tradicional',        preco_cent: 250, doce: false },
  suc:      { nome: 'A Suculenta',          preco_cent: 250, doce: false },
  caip:     { nome: 'A Caipira',            preco_cent: 250, doce: false },
  quer:     { nome: 'A Queridinha',         preco_cent: 250, doce: false },
  classica: { nome: 'A Clássica',           preco_cent: 250, doce: false },
  italiana: { nome: 'A Italiana',           preco_cent: 250, doce: false },
  todo:     { nome: 'A Que Todo Mundo Ama', preco_cent: 260, doce: true },
  irres:    { nome: 'A Irresistível',       preco_cent: 260, doce: true },
  dif:      { nome: 'A Diferentona',        preco_cent: 260, doce: true },
};

// Encomendas de congelados feitas a mao no painel (o cliente pede por
// WhatsApp e o Miguel regista aqui). Sao sempre para levantar (takeaway),
// entram como "pronto", descontam o stock de salgadas/doces e contam nos
// Recibos e na Caixa quando estiverem pagas. O preco por unidade e livre
// (varia por cliente/quantidade); o sinal fica guardado em itens.congelado.
async function criarEncomendaCongelados(request, env) {
  let b;
  try { b = await request.json(); } catch (e) { return j({ ok: false, erro: 'corpo invalido' }, 400); }
  const nome = limpar((b.nome || '').trim(), 80);
  if (!nome) return j({ ok: false, erro: 'nome em falta' }, 400);
  const tel = soDigitos(b.telefone);
  const linhasIn = Array.isArray(b.linhas) ? b.linhas.slice(0, 30) : [];
  if (!linhasIn.length) return j({ ok: false, erro: 'sem itens' }, 400);

  const itensLista = [];
  let total = 0, nEsf = 0;
  for (const l of linhasIn) {
    const sabor = SABORES[l && l.item];
    const n = Math.max(0, Math.min(999, parseInt(l && l.n, 10) || 0));
    const preco = Math.max(0, Math.min(100000, Math.round(Number(l && l.preco_cent)) || 0));
    if (!sabor || !n) return j({ ok: false, erro: 'item invalido' }, 400);
    itensLista.push({ item: l.item, nome: sabor.nome, doce: sabor.doce ? 1 : 0, n, preco_cent: preco });
    total += n * preco; nEsf += n;
  }
  const eur = c => (c / 100).toFixed(2).replace('.', ',') + '€';
  const metodo = b.metodo === 'dinheiro' ? 'dinheiro' : 'mbway';
  let sinal = Math.max(0, Math.round(Number(b.sinal_cent)) || 0);
  const pagoTotal = !!b.pago || (total > 0 && sinal >= total) || total === 0;
  if (pagoTotal) sinal = total;
  if (sinal > total) sinal = total;
  const levant = /^\d{4}-\d{2}-\d{2}$/.test(b.levantamento || '') ? b.levantamento : '';
  const notas = limpar((b.notas || '').trim(), 300) || '';

  // aviso (nao bloqueia) se o stock nao chega
  const aviso = [];
  const { results: salg } = await env.DB.prepare('SELECT nome, quantidade FROM stock_salgadas').all();
  const doceRow = await env.DB.prepare('SELECT quantidade FROM stock_doces WHERE id = 1').first();
  const falta = {};
  for (const it of itensLista) falta[it.doce ? '__doce' : it.nome] = (falta[it.doce ? '__doce' : it.nome] || 0) + it.n;
  for (const k of Object.keys(falta)) {
    const disp = k === '__doce' ? ((doceRow && doceRow.quantidade) || 0) : (((salg || []).find(x => x.nome === k) || {}).quantidade || 0);
    if (falta[k] > disp) aviso.push((k === '__doce' ? 'Doces' : k) + ': pediste ' + falta[k] + ', no stock ' + disp);
  }

  const linhasTxt = itensLista.map(it => `${it.n}× ${it.nome} (congelada, ${eur(it.preco_cent)} cada) — ${eur(it.n * it.preco_cent)}`);
  const itensObj = {
    linhas: linhasTxt,
    producao: itensLista.map(it => ({ sabor: it.nome, ing: '', extras: [], n: it.n, gratis: 0, doce: it.doce })),
    bebidas: [],
    pagamento: { metodo_pagamento: metodo },
    pagas_original: nEsf,
    congelado: { itens: itensLista, sinal_cent: sinal, levantamento: levant, notas },
  };
  if (notas) itensObj.observacao = notas;
  const itens = JSON.stringify(itensObj);

  const dia = diaLisboa();
  const agora = new Date().toISOString();
  const token = novoToken();
  const res = await env.DB.prepare(
    `INSERT INTO pedidos
       (dia, numero, senha, ensaio, estado, pago, modo, localidade, morada, total_cent, n_esfihas,
        itens, mensagem, criado_em, token, telefone, origem, campanha, nome, stock_debitado)
     SELECT ?, COALESCE(MAX(numero), 0) + 1, NULL, 0, 'pronto', ?, 'retirada', NULL, NULL, ?, ?, ?, ?, ?, ?, ?, 'congelados', NULL, ?, 1
       FROM pedidos WHERE ensaio = 0
     RETURNING id, numero, token`
  ).bind(dia, pagoTotal ? 1 : 0, total, nEsf, itens, 'Encomenda de congelados (registada no painel)', agora, token, tel, nome).first();

  const lote = [];
  for (const it of itensLista) {
    if (it.doce) {
      lote.push(env.DB.prepare('UPDATE stock_doces SET quantidade = MAX(0, quantidade - ?), atualizado_em = ? WHERE id = 1').bind(it.n, agora));
    } else {
      lote.push(env.DB.prepare('UPDATE stock_salgadas SET quantidade = MAX(0, quantidade - ?), atualizado_em = ? WHERE nome = ?').bind(it.n, agora, it.nome));
    }
  }
  if (lote.length) await env.DB.batch(lote);

  return j({ ok: true, id: res.id, numero: res.numero, token: res.token, dia, criado_em: agora, total_cent: total,
             sinal_cent: sinal, pago: pagoTotal ? 1 : 0, aviso_stock: aviso, estado: await estadoDoDia(env.DB, dia) });
}

// Acrescenta esfihas a um pedido ja enviado -- para quando o cliente pede
// mais depois (por telefone ou WhatsApp), seja a pagar ou como oferta.
// Atualiza a lista de producao, o total, o n_esfihas e debita o stock na
// hora, exatamente como se tivesse vindo no pedido desde o inicio.
async function adicionarItemPedido(request, env) {
  let b;
  try { b = await request.json(); } catch (e) { return j({ ok: false, erro: 'corpo invalido' }, 400); }
  const id = parseInt(b.id, 10);
  if (!id) return j({ ok: false, erro: 'id em falta' }, 400);
  const sabor = SABORES[b.item];
  if (!sabor) return j({ ok: false, erro: 'sabor invalido' }, 400);
  const n = Math.max(1, Math.min(50, parseInt(b.n, 10) || 0));
  const gratis = !!b.gratis;

  const p = await env.DB.prepare('SELECT * FROM pedidos WHERE id = ?').bind(id).first();
  if (!p) return j({ ok: false, erro: 'pedido nao encontrado' }, 404);

  let it = null;
  try { it = JSON.parse(p.itens || 'null'); } catch (e) {}
  if (!it || Array.isArray(it)) it = { linhas: [], producao: [], bebidas: [] };
  if (!Array.isArray(it.producao)) it.producao = [];
  if (!Array.isArray(it.linhas)) it.linhas = [];

  it.producao.push({
    sabor: sabor.nome, ing: '', extras: [], n, gratis: gratis ? n : 0, doce: sabor.doce ? 1 : 0,
    // acrescentado pelo painel (nao faz parte do pedido original do
    // cliente) -- permite desfazer a serio com ajustarItemAcrescentado,
    // ao contrario de uma linha original (ver comentario em ajustarProducaoPedido).
    acrescentado: true, preco_unit_cent: sabor.preco_cent,
  });
  it.linhas.push(`${n}x ${sabor.nome}${gratis ? ' (OFERTA -- acrescentado no painel)' : ' (acrescentado no painel)'}`);

  const novoNEsfihas = (p.n_esfihas || 0) + n;
  const novoTotalCent = (p.total_cent || 0) + (gratis ? 0 : n * sabor.preco_cent);
  const agora = new Date().toISOString();

  const lote = [
    env.DB.prepare('UPDATE pedidos SET itens = ?, n_esfihas = ?, total_cent = ?, atualizado_em = ? WHERE id = ?')
      .bind(JSON.stringify(it), novoNEsfihas, novoTotalCent, agora, id),
    env.DB.prepare('UPDATE stock SET usado = usado + ? WHERE dia = ?').bind(n, p.dia),
  ];
  if (sabor.doce) {
    lote.push(env.DB.prepare(
      `UPDATE stock_doces SET quantidade = MAX(0, quantidade - ?), atualizado_em = ? WHERE id = 1`
    ).bind(n, agora));
  } else {
    lote.push(env.DB.prepare(
      `UPDATE stock_salgadas SET quantidade = MAX(0, quantidade - ?), atualizado_em = ? WHERE nome = ?`
    ).bind(n, agora, sabor.nome));
  }
  await env.DB.batch(lote);

  return j({ ok: true, estado: await estadoDoDia(env.DB, p.dia) });
}

// Ajusta ou remove (novo_n = 0) uma linha de producao que foi acrescentada
// pelo proprio painel (adicionarItemPedido, linha.acrescentado = true).
// Ao contrario de ajustarProducaoPedido -- que corrige linhas do PEDIDO
// ORIGINAL sem nunca tocar total_cent, de proposito -- aqui o total
// cobrado segue a quantidade real desta linha, porque ela nunca fez parte
// do que o cliente pagou originalmente: foi o Miguel quem a acrescentou
// (por engano ou nao), por isso tem de dar para corrigir ou anular a
// serio, incluindo o valor. Pedido pelo Miguel em 2026-11-01 depois de
// reparar que remover um item acrescentado por engano nao devolvia o
// valor que tinha sido somado ao total.
async function ajustarItemAcrescentado(request, env) {
  let b;
  try { b = await request.json(); } catch (e) { return j({ ok: false, erro: 'corpo invalido' }, 400); }
  const id = parseInt(b.id, 10);
  if (!id) return j({ ok: false, erro: 'id em falta' }, 400);
  const idx = parseInt(b.idx, 10);
  if (!Number.isInteger(idx) || idx < 0) return j({ ok: false, erro: 'linha invalida' }, 400);
  const novoN = Math.max(0, Math.min(50, parseInt(b.novo_n, 10) || 0));

  const p = await env.DB.prepare('SELECT * FROM pedidos WHERE id = ?').bind(id).first();
  if (!p) return j({ ok: false, erro: 'pedido nao encontrado' }, 404);

  let it = null;
  try { it = JSON.parse(p.itens || 'null'); } catch (e) {}
  if (!it || Array.isArray(it) || !Array.isArray(it.producao) || !it.producao[idx]) {
    return j({ ok: false, erro: 'linha nao encontrada' }, 404);
  }
  const linha = it.producao[idx];
  if (!linha.acrescentado) {
    return j({ ok: false, erro: 'esta linha faz parte do pedido original -- usa a correcao de producao normal, que nao mexe no valor cobrado' }, 400);
  }

  const antigoN = Math.max(0, parseInt(linha.n, 10) || 0);
  const delta = novoN - antigoN;   // positivo = aumentar; negativo = reduzir/remover
  const ehGratis = (parseInt(linha.gratis, 10) || 0) > 0;
  const precoUnit = parseInt(linha.preco_unit_cent, 10) || 0;
  const doce = !!linha.doce;
  const sabor = linha.sabor;
  const agora = new Date().toISOString();

  const novoTotalCent = ehGratis ? (p.total_cent || 0) : Math.max(0, (p.total_cent || 0) + delta * precoUnit);
  const novoNEsfihas = Math.max(0, (p.n_esfihas || 0) + delta);

  it.linhas = Array.isArray(it.linhas) ? it.linhas : [];
  if (novoN === 0) {
    it.producao.splice(idx, 1);
    it.linhas.push(`Correção no painel: removido o item acrescentado ${antigoN}x ${sabor}${ehGratis ? '' : ` (devolvidos ${((antigoN * precoUnit) / 100).toFixed(2).replace('.', ',')}€)`}`);
  } else {
    linha.n = novoN;
    if (ehGratis) linha.gratis = novoN;
    it.linhas.push(`Correção no painel: item acrescentado ${sabor} passou de ${antigoN}x para ${novoN}x`);
  }

  const lote = [
    env.DB.prepare('UPDATE pedidos SET itens = ?, n_esfihas = ?, total_cent = ?, atualizado_em = ? WHERE id = ?')
      .bind(JSON.stringify(it), novoNEsfihas, novoTotalCent, agora, id),
  ];
  if (delta !== 0) {
    lote.push(env.DB.prepare('UPDATE stock SET usado = MAX(0, usado + ?) WHERE dia = ?').bind(delta, p.dia));
    if (doce) {
      lote.push(env.DB.prepare(
        `UPDATE stock_doces SET quantidade = MAX(0, quantidade - ?), atualizado_em = ? WHERE id = 1`
      ).bind(delta, agora));
    } else if (sabor) {
      lote.push(env.DB.prepare(
        `UPDATE stock_salgadas SET quantidade = MAX(0, quantidade - ?), atualizado_em = ? WHERE nome = ?`
      ).bind(delta, agora, sabor));
    }
  }
  await env.DB.batch(lote);

  return j({ ok: true, estado: await estadoDoDia(env.DB, p.dia) });
}

// Marca ou desmarca uma linha de producao (original OU acrescentada) como
// oferta, ajustando total_cent pela diferenca real -- ao contrario de
// ajustarProducaoPedido (que corrige QUANTIDADE sem nunca tocar no valor),
// isto serve especificamente para quando a contagem ja esta certa mas o
// estado "oferta" e que ficou errado (ex.: marcado oferta por engano, ou
// o cliente tem direito a uma oferta que ainda nao foi refletida no
// valor). gratis_novo e a quantidade dessa linha que deve ficar como
// oferta (0 = nada e oferta / paga tudo; ate linha.n = linha toda e
// oferta). Pedido pelo Miguel em 2026-11-01.
async function marcarOfertaProducao(request, env) {
  let b;
  try { b = await request.json(); } catch (e) { return j({ ok: false, erro: 'corpo invalido' }, 400); }
  const id = parseInt(b.id, 10);
  if (!id) return j({ ok: false, erro: 'id em falta' }, 400);
  const idx = parseInt(b.idx, 10);
  if (!Number.isInteger(idx) || idx < 0) return j({ ok: false, erro: 'linha invalida' }, 400);

  const p = await env.DB.prepare('SELECT * FROM pedidos WHERE id = ?').bind(id).first();
  if (!p) return j({ ok: false, erro: 'pedido nao encontrado' }, 404);

  let it = null;
  try { it = JSON.parse(p.itens || 'null'); } catch (e) {}
  if (!it || Array.isArray(it) || !Array.isArray(it.producao) || !it.producao[idx]) {
    return j({ ok: false, erro: 'linha nao encontrada' }, 404);
  }
  const linha = it.producao[idx];
  const n = Math.max(0, parseInt(linha.n, 10) || 0);
  const antigoGratis = Math.max(0, Math.min(n, parseInt(linha.gratis, 10) || 0));
  const novoGratis = Math.max(0, Math.min(n, parseInt(b.gratis_novo, 10) || 0));

  // Preco unitario: linhas acrescentadas ja o guardam; linhas do pedido
  // original vao buscar ao menu atual pelo nome do sabor.
  let precoUnit = parseInt(linha.preco_unit_cent, 10) || 0;
  if (!precoUnit) {
    const sab = Object.values(SABORES).find(s => s.nome === linha.sabor);
    precoUnit = sab ? sab.preco_cent : 0;
  }

  const deltaGratis = novoGratis - antigoGratis;   // positivo = mais unidades a ficar oferta (desconta)
  const novoTotalCent = Math.max(0, (p.total_cent || 0) - deltaGratis * precoUnit);
  linha.gratis = novoGratis;

  it.linhas = Array.isArray(it.linhas) ? it.linhas : [];
  it.linhas.push(novoGratis > antigoGratis
    ? `Correção no painel: ${novoGratis}x ${linha.sabor} passou a oferta (desconto de ${((deltaGratis * precoUnit) / 100).toFixed(2).replace('.', ',')}€)`
    : `Correção no painel: ${linha.sabor} deixou de ser oferta (acrescentado ${((-deltaGratis * precoUnit) / 100).toFixed(2).replace('.', ',')}€)`);

  const agora = new Date().toISOString();
  await env.DB.prepare('UPDATE pedidos SET itens = ?, total_cent = ?, atualizado_em = ? WHERE id = ?')
    .bind(JSON.stringify(it), novoTotalCent, agora, id).run();

  return j({ ok: true, estado: await estadoDoDia(env.DB, p.dia) });
}

// Corrige diretamente o VALOR TOTAL de um pedido, sem mexer na producao
// nem no stock -- para casos que o modelo de "acrescentar/remover por
// item" nao cobre bem, como um combo de preco fixo (ex.: "Combo a Dois"),
// em que a soma dos precos unitarios dos itens nao bate certo com o preco
// real do combo. Pedido pelo Miguel em 2026-11-01. Fica sempre registado
// em itens.linhas para ficar rastreavel quem/quando mudou o valor.
// Corrige o telefone de um pedido (erro de digitacao do cliente, indicativo
// errado, etc.) para a equipa conseguir avisar o cliente. Normaliza para
// "+<indicativo><numero>" e valida: +351 so com numero movel (9xxxxxxxx).
// Pesquisa de pedidos por nome ou telefone (de qualquer data), para corrigir
// numeros enganados a partir do ecra dos Fieis sem andar dia a dia.
async function pedidosDoCliente(request, env) {
  const url = new URL(request.url);
  const q = (url.searchParams.get('q') || '').trim().slice(0, 60);
  const digitos = q.replace(/\D/g, '');
  const conds = [];
  const binds = [];
  if (q.length >= 2 && !/^[\d\s+().-]+$/.test(q)) { conds.push('nome LIKE ?'); binds.push('%' + q + '%'); }
  if (digitos.length >= 4) {
    conds.push("replace(replace(replace(replace(telefone, '+', ''), ' ', ''), '-', ''), '.', '') LIKE ?");
    binds.push('%' + digitos + '%');
  }
  if (!conds.length) return j({ ok: true, pedidos: [] });
  const { results } = await env.DB.prepare(
    `SELECT id, nome, telefone, estado, origem, pago, total_cent, criado_em,
            CASE WHEN ${SQL_CONTA_FIEL} THEN 1 ELSE 0 END AS conta
       FROM pedidos WHERE ensaio = 0 AND (${conds.join(' OR ')})
      ORDER BY criado_em DESC LIMIT 80`
  ).bind(...binds).all();
  let todos = results || [];
  // Junta tambem os pedidos feitos com o mesmo numero dos que foram encontrados
  // (o cliente pode ter escrito o nome de outra forma noutro pedido).
  const chaves = [...new Set(todos.map(r => chaveTelefone(r.telefone)).filter(Boolean))].slice(0, 10);
  if (chaves.length) {
    const { results: extra } = await env.DB.prepare(
      `SELECT id, nome, telefone, estado, origem, pago, total_cent, criado_em,
              CASE WHEN ${SQL_CONTA_FIEL} THEN 1 ELSE 0 END AS conta
         FROM pedidos WHERE ensaio = 0 AND ${SQL_TEL_CHAVE} IN (${chaves.map(() => '?').join(',')})
        ORDER BY criado_em DESC LIMIT 80`
    ).bind(...chaves).all();
    const vistos = new Set(todos.map(r => r.id));
    (extra || []).forEach(r => { if (!vistos.has(r.id)) todos.push(r); });
    todos.sort((a, b) => String(b.criado_em).localeCompare(String(a.criado_em)));
    todos = todos.slice(0, 80);
  }
  return j({ ok: true, pedidos: todos });
}

async function corrigirTelefonePedido(request, env) {
  let b;
  try { b = await request.json(); } catch (e) { return j({ ok: false, erro: 'corpo invalido' }, 400); }
  const id = parseInt(b.id, 10);
  if (!id) return j({ ok: false, erro: 'id em falta' }, 400);
  let t = String(b.telefone || '').trim().replace(/[\s().-]/g, '');
  if (t.startsWith('00')) t = '+' + t.slice(2);
  if (!t.startsWith('+')) {
    if (/^9\d{8}$/.test(t)) t = '+351' + t;
    else return j({ ok: false, erro: 'telefone_sem_indicativo' }, 400);
  }
  if (!/^\+\d{8,15}$/.test(t)) return j({ ok: false, erro: 'telefone_invalido' }, 400);
  if (t.startsWith('+351') && !/^\+3519\d{8}$/.test(t)) return j({ ok: false, erro: 'telefone_pt_invalido' }, 400);

  const p = await env.DB.prepare('SELECT * FROM pedidos WHERE id = ?').bind(id).first();
  if (!p) return j({ ok: false, erro: 'pedido nao encontrado' }, 404);

  let it = null;
  try { it = JSON.parse(p.itens || 'null'); } catch (e) {}
  if (it && !Array.isArray(it)) {
    it.linhas = Array.isArray(it.linhas) ? it.linhas : [];
    it.linhas.push(`Correção no painel: telefone alterado de ${p.telefone || '(vazio)'} para ${t}`);
  }
  const agora = new Date().toISOString();
  await env.DB.prepare('UPDATE pedidos SET telefone = ?, itens = ?, atualizado_em = ? WHERE id = ?')
    .bind(t, it && !Array.isArray(it) ? JSON.stringify(it) : p.itens, agora, id).run();
  // Se o pedido ja conta (entregue/pago) e o numero certo chega a 5, 10... gera o codigo de fidelidade.
  await verificarFidelidade(env, { ...p, telefone: t });
  if (p.telefone && chaveTelefone(p.telefone) !== chaveTelefone(t)) await revogarFidelidade(env, p.telefone);
  return j({ ok: true, telefone: t });
}

async function corrigirTotalPedido(request, env) {
  let b;
  try { b = await request.json(); } catch (e) { return j({ ok: false, erro: 'corpo invalido' }, 400); }
  const id = parseInt(b.id, 10);
  if (!id) return j({ ok: false, erro: 'id em falta' }, 400);
  const totalCentNovo = parseInt(b.total_cent, 10);
  if (!Number.isFinite(totalCentNovo) || totalCentNovo < 0) {
    return j({ ok: false, erro: 'valor invalido' }, 400);
  }

  const p = await env.DB.prepare('SELECT * FROM pedidos WHERE id = ?').bind(id).first();
  if (!p) return j({ ok: false, erro: 'pedido nao encontrado' }, 404);

  let it = null;
  try { it = JSON.parse(p.itens || 'null'); } catch (e) {}
  if (!it || Array.isArray(it)) it = { linhas: [], producao: [], bebidas: [] };
  it.linhas = Array.isArray(it.linhas) ? it.linhas : [];
  const antigo = p.total_cent || 0;
  it.linhas.push(`Correção no painel: valor total ajustado manualmente de ${(antigo / 100).toFixed(2).replace('.', ',')}€ para ${(totalCentNovo / 100).toFixed(2).replace('.', ',')}€`);

  const agora = new Date().toISOString();
  await env.DB.prepare('UPDATE pedidos SET itens = ?, total_cent = ?, atualizado_em = ? WHERE id = ?')
    .bind(JSON.stringify(it), totalCentNovo, agora, id).run();

  return j({ ok: true, estado: await estadoDoDia(env.DB, p.dia) });
}

// Corrige a PRODUCAO de um pedido ja enviado (o que vai para a cozinha e
// para o talao), sem alterar o preco cobrado ao cliente -- para o caso de
// um pedido especial dentro de um combo (ex.: cliente preferiu 17 salgadas
// e 3 doces em vez da proporcao normal do combo): o total de esfihas e o
// total a pagar ja estavam certos desde o inicio, so a REPARTICAO por
// sabor/doce e que ficou errada. Serve tambem para simplesmente remover
// uma linha (novo_n = 0) quando uma esfiha foi lancada a mais por engano.
// idx identifica a linha dentro de itens.producao (a ordem em que aparece
// no painel). O stock (salgada/doce especifico) e ajustado pela diferenca
// entre a quantidade antiga e a nova -- novo_n maior debita mais stock,
// menor devolve. n_esfihas e stock.usado tambem seguem essa diferenca
// (reflete o que esta mesmo a ser produzido), mas total_cent NUNCA muda
// aqui -- quem quiser alterar o valor cobrado usa "Adicionar item" (que
// soma ao total) ou cancela o pedido.
async function ajustarProducaoPedido(request, env) {
  let b;
  try { b = await request.json(); } catch (e) { return j({ ok: false, erro: 'corpo invalido' }, 400); }
  const id = parseInt(b.id, 10);
  if (!id) return j({ ok: false, erro: 'id em falta' }, 400);
  const idx = parseInt(b.idx, 10);
  if (!Number.isInteger(idx) || idx < 0) return j({ ok: false, erro: 'linha invalida' }, 400);
  const novoN = Math.max(0, Math.min(999, parseInt(b.novo_n, 10) || 0));

  const p = await env.DB.prepare('SELECT * FROM pedidos WHERE id = ?').bind(id).first();
  if (!p) return j({ ok: false, erro: 'pedido nao encontrado' }, 404);

  let it = null;
  try { it = JSON.parse(p.itens || 'null'); } catch (e) {}
  if (!it || Array.isArray(it) || !Array.isArray(it.producao) || !it.producao[idx]) {
    return j({ ok: false, erro: 'linha nao encontrada' }, 404);
  }
  const linha = it.producao[idx];
  const antigoN = Math.max(0, parseInt(linha.n, 10) || 0);
  const delta = novoN - antigoN;   // positivo = produzir mais (gasta mais stock); negativo = devolve stock
  const doce = !!linha.doce;
  const sabor = linha.sabor;

  // Quantas esfihas estao pagas AGORA (antes desta correcao) e quantas
  // foram mesmo pagas quando o pedido foi criado (baseline, nunca muda
  // com correcoes do painel -- so muda se o cliente pagar mais a serio).
  const pagoAntesTotal = (it.producao || []).reduce((s, x) => s + Math.max(0, (parseInt(x.n, 10) || 0) - (parseInt(x.gratis, 10) || 0)), 0);
  const pagasOriginal = Number.isFinite(it.pagas_original) ? it.pagas_original : pagoAntesTotal;

  if (novoN === 0) {
    it.producao.splice(idx, 1);
  } else {
    linha.n = novoN;
    const gratisAntigo = Math.max(0, parseInt(linha.gratis, 10) || 0);
    if (delta > 0) {
      // Por defeito assume-se que o acrescimo e so uma troca (ex.: tirar
      // 1 tradicional e pôr 1 suculenta) -- continua pago. So se isto
      // empurrar o total pago do pedido PARA ALEM do que foi mesmo pago
      // na altura e que a diferenca conta como oferta/correcao.
      const pagoDepoisSemForcar = pagoAntesTotal + delta;
      const excesso = Math.max(0, pagoDepoisSemForcar - pagasOriginal);
      linha.gratis = Math.min(novoN, gratisAntigo + excesso);
    } else {
      linha.gratis = Math.min(novoN, gratisAntigo);
    }
  }
  it.linhas = Array.isArray(it.linhas) ? it.linhas : [];
  it.linhas.push(novoN === 0
    ? `Correção no painel: removida a linha ${antigoN}x ${sabor}`
    : `Correção no painel: ${sabor} passou de ${antigoN}x para ${novoN}x`);

  const novoNEsfihas = Math.max(0, (p.n_esfihas || 0) + delta);
  const agora = new Date().toISOString();

  const lote = [
    env.DB.prepare('UPDATE pedidos SET itens = ?, n_esfihas = ?, atualizado_em = ? WHERE id = ?')
      .bind(JSON.stringify(it), novoNEsfihas, agora, id),
  ];
  if (delta !== 0) {
    lote.push(env.DB.prepare('UPDATE stock SET usado = MAX(0, usado + ?) WHERE dia = ?').bind(delta, p.dia));
    if (doce) {
      lote.push(env.DB.prepare(
        `UPDATE stock_doces SET quantidade = MAX(0, quantidade - ?), atualizado_em = ? WHERE id = 1`
      ).bind(delta, agora));
    } else if (sabor) {
      lote.push(env.DB.prepare(
        `UPDATE stock_salgadas SET quantidade = MAX(0, quantidade - ?), atualizado_em = ? WHERE nome = ?`
      ).bind(delta, agora, sabor));
    }
  }
  await env.DB.batch(lote);

  return j({ ok: true, estado: await estadoDoDia(env.DB, p.dia) });
}

// Acrescenta uma linha de producao NOVA a um pedido ja enviado, sem
// alterar o preco (irmao de ajustarProducaoPedido -- esse corrige uma
// linha existente, este cria uma linha onde antes nao havia nenhuma, ex.:
// trocar uma esfiha de um sabor por outro dentro do mesmo combo).
async function adicionarProducaoPedido(request, env) {
  let b;
  try { b = await request.json(); } catch (e) { return j({ ok: false, erro: 'corpo invalido' }, 400); }
  const id = parseInt(b.id, 10);
  if (!id) return j({ ok: false, erro: 'id em falta' }, 400);
  const sabor = SABORES[b.item];
  if (!sabor) return j({ ok: false, erro: 'sabor invalido' }, 400);
  const n = Math.max(1, Math.min(999, parseInt(b.n, 10) || 0));

  const p = await env.DB.prepare('SELECT * FROM pedidos WHERE id = ?').bind(id).first();
  if (!p) return j({ ok: false, erro: 'pedido nao encontrado' }, 404);

  let it = null;
  try { it = JSON.parse(p.itens || 'null'); } catch (e) {}
  if (!it || Array.isArray(it)) it = { linhas: [], producao: [], bebidas: [] };
  if (!Array.isArray(it.producao)) it.producao = [];
  if (!Array.isArray(it.linhas)) it.linhas = [];

  const pagoAntesTotalAdic = (it.producao || []).reduce((s, x) => s + Math.max(0, (parseInt(x.n, 10) || 0) - (parseInt(x.gratis, 10) || 0)), 0);
  const pagasOriginalAdic = Number.isFinite(it.pagas_original) ? it.pagas_original : pagoAntesTotalAdic;
  const pagoDepoisSemForcarAdic = pagoAntesTotalAdic + n;
  const excessoAdic = Math.max(0, pagoDepoisSemForcarAdic - pagasOriginalAdic);
  const gratisNovaLinha = Math.min(n, excessoAdic);
  it.producao.push({ sabor: sabor.nome, ing: '', extras: [], n, gratis: gratisNovaLinha, doce: sabor.doce ? 1 : 0 });
  it.linhas.push(`Correção no painel: + ${n}x ${sabor.nome} (sem alterar o preço)`);

  const novoNEsfihas = (p.n_esfihas || 0) + n;
  const agora = new Date().toISOString();

  const lote = [
    env.DB.prepare('UPDATE pedidos SET itens = ?, n_esfihas = ?, atualizado_em = ? WHERE id = ?')
      .bind(JSON.stringify(it), novoNEsfihas, agora, id),
    env.DB.prepare('UPDATE stock SET usado = usado + ? WHERE dia = ?').bind(n, p.dia),
  ];
  if (sabor.doce) {
    lote.push(env.DB.prepare(
      `UPDATE stock_doces SET quantidade = MAX(0, quantidade - ?), atualizado_em = ? WHERE id = 1`
    ).bind(n, agora));
  } else {
    lote.push(env.DB.prepare(
      `UPDATE stock_salgadas SET quantidade = MAX(0, quantidade - ?), atualizado_em = ? WHERE nome = ?`
    ).bind(n, agora, sabor.nome));
  }
  await env.DB.batch(lote);

  return j({ ok: true, estado: await estadoDoDia(env.DB, p.dia) });
}

// Resolve uma linha opaca "Oferta Nx bebida... (a escolha da casa)" (do
// Combo Junta a Malta) nas garrafas reais escolhidas pelo Miguel/estafeta.
// Em vez de ficar por conta de alguem ir ao stock no fim do dia reconciliar
// o que foi oferecido, o painel pergunta aqui quais bebidas foram dadas e
// so entao desconta o stock -- a oferta so nao descontava automaticamente
// porque, ate agora, nao se sabia qual garrafa tinha sido de facto usada.
async function resolverOfertaBebida(request, env) {
  let b;
  try { b = await request.json(); } catch (e) { return j({ ok: false, erro: 'corpo invalido' }, 400); }
  const id = parseInt(b.id, 10);
  if (!id) return j({ ok: false, erro: 'id em falta' }, 400);
  const idx = parseInt(b.idx, 10);
  if (!Number.isInteger(idx) || idx < 0) return j({ ok: false, erro: 'linha invalida' }, 400);
  const escolhas = Array.isArray(b.escolhas) ? b.escolhas.map(x => limpar(x, 80)).filter(Boolean) : [];

  const p = await env.DB.prepare('SELECT * FROM pedidos WHERE id = ?').bind(id).first();
  if (!p) return j({ ok: false, erro: 'pedido nao encontrado' }, 404);

  let it = null;
  try { it = JSON.parse(p.itens || 'null'); } catch (e) {}
  if (!it || Array.isArray(it) || !Array.isArray(it.bebidas) || !it.bebidas[idx]) {
    return j({ ok: false, erro: 'linha nao encontrada' }, 404);
  }
  const linha = it.bebidas[idx];
  const info = parseOfertaOpaca(linha.nome);
  if (!info) return j({ ok: false, erro: 'esta linha ja esta resolvida' }, 400);
  if (escolhas.length !== info.n) {
    return j({ ok: false, erro: `sao precisas ${info.n} escolha(s), vieram ${escolhas.length}` }, 400);
  }

  const validas = await env.DB.prepare(
    'SELECT nome FROM stock_bebidas WHERE por_pedido = 0'
  ).all();
  const nomesValidos = new Set((validas.results || [])
    .map(r => r.nome)
    .filter(nome => ehBebida1L(nome) === (info.tipo === 'litro')));
  for (const esc of escolhas) {
    if (!nomesValidos.has(esc)) return j({ ok: false, erro: `bebida invalida: ${esc}` }, 400);
  }

  const contagem = new Map();
  for (const esc of escolhas) contagem.set(esc, (contagem.get(esc) || 0) + 1);

  const novasLinhas = Array.from(contagem.entries()).map(([nome, n]) => ({ nome: `${nome} (grátis)`, n }));
  it.bebidas = [...it.bebidas.slice(0, idx), ...novasLinhas, ...it.bebidas.slice(idx + 1)];
  it.linhas = Array.isArray(it.linhas) ? it.linhas : [];
  it.linhas.push(`Oferta de bebidas resolvida: ${escolhas.join(', ')}`);

  const agora = new Date().toISOString();
  const lote = [
    env.DB.prepare('UPDATE pedidos SET itens = ?, atualizado_em = ? WHERE id = ?')
      .bind(JSON.stringify(it), agora, id),
  ];
  for (const [nome, n] of contagem.entries()) {
    lote.push(env.DB.prepare(
      `UPDATE stock_bebidas SET quantidade = MAX(0, quantidade - ?), atualizado_em = ? WHERE nome = ?`
    ).bind(n, agora, nome));
  }
  await env.DB.batch(lote);

  return j({ ok: true, estado: await estadoDoDia(env.DB, p.dia) });
}

async function mudarPedido(request, env) {
  let b;
  try { b = await request.json(); } catch (e) { return j({ ok: false, erro: 'corpo invalido' }, 400); }
  const id = parseInt(b.id, 10);
  if (!id) return j({ ok: false, erro: 'id em falta' }, 400);

  const p = await env.DB.prepare('SELECT * FROM pedidos WHERE id = ?').bind(id).first();
  if (!p) return j({ ok: false, erro: 'pedido nao encontrado' }, 404);

  const estado = b.estado && ESTADOS.includes(b.estado) ? b.estado : p.estado;
  const pago = b.pago === undefined ? p.pago : (b.pago ? 1 : 0);
  // Motivo do cancelamento -- so para controlo interno (ver depois porque
  // foi cancelado); nunca apagado ao mudar outros campos, so quando vier
  // explicitamente no pedido.
  const motivoCancelamento = b.motivo_cancelamento !== undefined
    ? (b.motivo_cancelamento || null)
    : p.motivo_cancelamento;
  const agora = new Date().toISOString();

  // O stock ja desce na criacao do pedido (novoPedido), nao aqui -- isto
  // so cobre dois casos: um pedido antigo que por algum motivo ainda nao
  // tinha sido debitado ao chegar a preparacao, e o cancelamento, que
  // devolve o que foi descontado (pedidos de ensaio tambem descontam, para
  // o ensaio ser fiel; o "Apagar ensaios" devolve tudo).
  const entraEmProducao = estado === 'preparacao' && !p.stock_debitado;
  const saiDeProducao = estado === 'cancelado' && p.stock_debitado;

  const lote = [
    env.DB.prepare('UPDATE pedidos SET estado = ?, pago = ?, atualizado_em = ?, stock_debitado = ?, motivo_cancelamento = ? WHERE id = ?')
      .bind(estado, pago, agora,
            entraEmProducao ? 1 : (saiDeProducao ? 0 : p.stock_debitado), motivoCancelamento, id),
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

  // Cartao de fidelidade: se este pedido acabou de ficar entregue (ou um
  // congelado acabou de ser pago), ve se o cliente chegou a um multiplo de 5.
  const acabouDeContar = (estado === 'entregue' && p.estado !== 'entregue')
    || (pago && !p.pago);
  const contavaAntes = pedidoContaFiel(p);
  const contaAgora = pedidoContaFiel({ ...p, estado, pago });
  if (acabouDeContar || (contaAgora && !contavaAntes)) await verificarFidelidade(env, p);
  if (contavaAntes && !contaAgora) await revogarFidelidade(env, p.telefone);

  return j({ ok: true, estado: await estadoDoDia(env.DB, p.dia) });
}

async function mudarStock(request, env) {
  let b;
  try { b = await request.json(); } catch (e) { return j({ ok: false, erro: 'corpo invalido' }, 400); }
  const dia = limpar(b.dia, 10) || diaLisboa();
  await estadoDoDia(env.DB, dia);
  if (b.aberto === null) {
    // Limpa o override e volta a seguir o horario automatico ja (botao
    // "Usar horario automatico agora" no painel) -- util se o dono se
    // enganou ao forcar aberto/fechado e quer desfazer sem esperar pela
    // proxima transicao.
    await env.DB.prepare('UPDATE stock SET override_expira = NULL WHERE dia = ?').bind(dia).run();
  } else if (b.aberto !== undefined) {
    // O override forcado agora so vale ATE a proxima transicao automatica
    // (abrir ou fechar) ou a meia-noite seguinte, o que vier primeiro --
    // depois disso a loja volta a seguir o horario sozinha, sem precisar
    // de nenhum botao.
    const expira = expiraOverride(new Date()).toISOString();
    await env.DB.prepare('UPDATE stock SET aberto = ?, override_expira = ? WHERE dia = ?').bind(b.aberto ? 1 : 0, expira, dia).run();
  }
  return j({ ok: true, estado: await estadoDoDia(env.DB, dia) });
}

// Calcula o desconto (em centimos) de um codigo promocional para um pedido
// concreto. Devolve null quando o pedido nao qualifica (menos esfihas que o
// minimo exigido pelo codigo) -- nesse caso o codigo nao se aplica.
//
// Dois modos, conforme os campos preenchidos na linha do codigo:
// - Sem preco_fixo_cent: desconto fixo de desconto_cent, sempre o mesmo
//   valor (o comportamento original, ex.: premio de sorteio).
// - Com preco_fixo_cent: so quando o pedido tiver EXATAMENTE min_esfihas
//   esfihas, o desconto ajusta-se sozinho para o total dar esse preco fixo
//   (ex.: 17 EUR, seja qual for a mistura de salgadas/doces), limitado a
//   desconto_cent para nunca dar mais desconto que o previsto. Acima de
//   min_esfihas, deixa de ajustar ao preco fixo e passa a aplicar so o
//   desconto_cent normal (para nao dar descontos cada vez maiores em
//   pedidos cada vez maiores).
// ------------------------------------------------------------- fidelidade
// Cartao de fidelidade: cada 5 pedidos entregues do mesmo telefone geram um
// codigo FIEL-XXXXXX de 10% (so nas esfihas e bebidas, nunca na taxa de
// entrega), de uso unico e ligado a esse telefone. O ciclo repete-se de 5
// em 5 (5.o, 10.o, 15.o...). Conta pedidos reais (nao ensaio, nao
// cancelados) que estejam pagos (ou entregues): o carimbo entra assim que o pedido e marcado como pago.
const FIEL_CADA = 5;
const FIEL_PCT = 10;
let fidelidadeColunasOk = false;

// Acrescenta as colunas novas a tabela codigos_promo na primeira vez que
// sao precisas (sem migracao manual). "duplicate column" = ja existe.
async function garantirFidelidade(env) {
  if (fidelidadeColunasOk) return;
  const cols = [
    'desconto_pct INTEGER NOT NULL DEFAULT 0',
    'telefone TEXT',
    'tipo TEXT',
    'marco INTEGER',
    'pedido_origem_id INTEGER',
    'desconto_usado_cent INTEGER',
  ];
  for (const c of cols) {
    try { await env.DB.prepare('ALTER TABLE codigos_promo ADD COLUMN ' + c).run(); } catch (e) { /* ja existe */ }
  }
  fidelidadeColunasOk = true;
}

// Ultimos 9 digitos do telefone (ignora indicativo, + e espacos) -- assim
// "+351 931 441 324" e "931441324" sao o mesmo cliente.
function chaveTelefone(v) {
  const d = String(v || '').replace(/\D/g, '');
  return d.length >= 9 ? d.slice(-9) : null;
}

const SQL_TEL_CHAVE = "substr(replace(replace(replace(replace(telefone, '+', ''), ' ', ''), '-', ''), '.', ''), -9)";
// Valor minimo (so esfihas e bebidas, sem a taxa de entrega) para o pedido
// dar carimbo: evita juntar carimbos com pedidos de quase nada.
const FIEL_MIN_CENT = 500;
const SQL_VALOR_ITENS = `(total_cent - CASE WHEN modo = 'entrega' AND dia != '2026-10-31' THEN ${ENTREGA_FIXA_CENT} ELSE 0 END)`;
const SQL_CONTA_FIEL = `ensaio = 0 AND estado != 'cancelado' AND (pago = 1 OR estado = 'entregue') AND ${SQL_VALOR_ITENS} >= ${FIEL_MIN_CENT}`;
function pedidoContaFiel(r) {
  if (!r || r.ensaio || r.estado === 'cancelado' || !(r.pago || r.estado === 'entregue')) return false;
  const taxa = (r.modo === 'entrega' && r.dia !== '2026-10-31') ? ENTREGA_FIXA_CENT : 0;
  return ((r.total_cent || 0) - taxa) >= FIEL_MIN_CENT;
}

async function contarPedidosFiel(env, chave) {
  if (!chave) return 0;
  const r = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM pedidos WHERE ${SQL_CONTA_FIEL} AND ${SQL_TEL_CHAVE} = ?`
  ).bind(chave).first();
  return (r && r.n) || 0;
}

function gerarCodigoFiel() {
  const alfabeto = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';   // sem I, L, O, 0, 1
  const buf = new Uint8Array(6);
  crypto.getRandomValues(buf);
  let c = '';
  for (const x of buf) c += alfabeto[x % alfabeto.length];
  return 'FIEL-' + c;
}

// Chamado quando um pedido passa a "entregue" (ou um congelado a pago).
// Se o cliente acabou de chegar a um multiplo de 5, cria o codigo (uma so
// vez por marco). Nunca deixa a mudanca de estado falhar por causa disto.
// Se um cliente perdeu carimbos (pedido cancelado, numero corrigido), apaga os
// codigos de fidelidade ainda por usar que ja nao correspondem aos pedidos.
async function revogarFidelidade(env, telefone) {
  try {
    const chave = chaveTelefone(telefone);
    if (!chave) return;
    await garantirFidelidade(env);
    const n = await contarPedidosFiel(env, chave);
    await env.DB.prepare(
      "DELETE FROM codigos_promo WHERE tipo = 'fidelidade' AND telefone = ? AND COALESCE(usos_contagem, 0) = 0 AND marco > ?"
    ).bind(chave, n).run();
  } catch (e) { /* nunca bloqueia */ }
}

// Apagar manualmente um codigo de fidelidade que ainda nao foi usado.
async function apagarCodigoFiel(request, env) {
  let b;
  try { b = await request.json(); } catch (e) { return j({ ok: false, erro: 'corpo invalido' }, 400); }
  const codigo = String(b.codigo || '').trim().toUpperCase();
  if (!/^FIEL-[A-Z0-9]{4,10}$/.test(codigo)) return j({ ok: false, erro: 'codigo invalido' }, 400);
  await garantirFidelidade(env);
  const r = await env.DB.prepare(
    "DELETE FROM codigos_promo WHERE codigo = ? AND tipo = 'fidelidade' AND COALESCE(usos_contagem, 0) = 0"
  ).bind(codigo).run();
  if (!r.meta || !r.meta.changes) return j({ ok: false, erro: 'nao_apagado' }, 404);
  return j({ ok: true });
}

async function verificarFidelidade(env, p) {
  try {
    if (!p || p.ensaio) return null;
    const chave = chaveTelefone(p.telefone);
    if (!chave) return null;
    await garantirFidelidade(env);
    const n = await contarPedidosFiel(env, chave);
    if (n < FIEL_CADA || n % FIEL_CADA !== 0) return null;
    const ja = await env.DB.prepare(
      "SELECT codigo FROM codigos_promo WHERE tipo = 'fidelidade' AND telefone = ? AND marco = ?"
    ).bind(chave, n).first();
    if (ja) return ja.codigo;
    const codigo = gerarCodigoFiel();
    await env.DB.prepare(
      `INSERT INTO codigos_promo (codigo, descricao, desconto_cent, min_esfihas, usos_max, usos_contagem, usado,
                                  criado_em, desconto_pct, telefone, tipo, marco, pedido_origem_id)
       VALUES (?, ?, 0, 0, 1, 0, 0, ?, ?, ?, 'fidelidade', ?, ?)`
    ).bind(codigo, `Fidelidade: ${n} pedidos`, new Date().toISOString(), FIEL_PCT, chave, n, p.id).run();
    return codigo;
  } catch (e) {
    return null;
  }
}

// Estado do cartao de fidelidade de um telefone: quantos pedidos contam,
// quantos carimbos mostra o cartao atual (0 a 5) e os codigos ainda por usar.
// Com o 5.o/10.o pedido feito e o codigo por usar, o cartao mostra 5/5;
// depois de o codigo ser usado, comeca um cartao novo a 0.
function carimbosDoCartao(n, temCodigoPorUsar) {
  const m = n % FIEL_CADA;
  if (n > 0 && m === 0) return temCodigoPorUsar ? FIEL_CADA : 0;
  return m;
}

async function estadoFidelidade(env, telefone) {
  const chave = chaveTelefone(telefone);
  if (!chave) return null;
  await garantirFidelidade(env);
  const n = await contarPedidosFiel(env, chave);
  const { results } = await env.DB.prepare(
    "SELECT codigo, marco, usos_contagem, usos_max FROM codigos_promo WHERE tipo = 'fidelidade' AND telefone = ? ORDER BY marco ASC"
  ).bind(chave).all();
  const porUsar = (results || []).filter(c => (c.usos_contagem || 0) < (c.usos_max || 1));
  return {
    n, cada: FIEL_CADA, pct: FIEL_PCT,
    carimbos: carimbosDoCartao(n, porUsar.length > 0),
    codigo: porUsar.length ? porUsar[0].codigo : null,
    codigos_por_usar: porUsar.length,
  };
}

// Painel: todos os cartoes de fidelidade (um por cliente) com os codigos
// gerados, se ja foram usados e quanto se descontou.
async function listarFidelidade(request, env) {
  await garantirFidelidade(env);
  const { results: peds } = await env.DB.prepare(
    `SELECT nome, telefone, criado_em FROM pedidos WHERE ${SQL_CONTA_FIEL} AND telefone IS NOT NULL ORDER BY criado_em ASC`
  ).all();
  const clientes = {};
  (peds || []).forEach(r => {
    const k = chaveTelefone(r.telefone);
    if (!k) return;
    const c = clientes[k] || (clientes[k] = { chave: k, nome: '', telefone: '', n: 0, ultimo: '', codigos: [] });
    c.n += 1;
    if (r.nome) c.nome = r.nome;
    c.telefone = r.telefone;
    c.ultimo = r.criado_em;
  });
  const { results: cods } = await env.DB.prepare(
    "SELECT codigo, telefone, marco, usos_contagem, usos_max, usado_em, usado_pedido_id, desconto_usado_cent, criado_em FROM codigos_promo WHERE tipo = 'fidelidade' ORDER BY marco ASC"
  ).all();
  let emitidos = 0, usados = 0, descontado = 0;
  (cods || []).forEach(c => {
    emitidos += 1;
    const usado = (c.usos_contagem || 0) >= (c.usos_max || 1);
    if (usado) { usados += 1; descontado += c.desconto_usado_cent || 0; }
    const cli = clientes[c.telefone] || (clientes[c.telefone] = { chave: c.telefone, nome: '', telefone: c.telefone, n: 0, ultimo: '', codigos: [] });
    cli.codigos.push({ codigo: c.codigo, marco: c.marco, usado, usado_em: c.usado_em || null,
                       desconto_cent: c.desconto_usado_cent || 0, criado_em: c.criado_em });
  });
  const lista = Object.values(clientes).map(c => {
    const porUsar = c.codigos.filter(x => !x.usado).length;
    return Object.assign(c, { carimbos: carimbosDoCartao(c.n, porUsar > 0), por_usar: porUsar });
  }).sort((a, b) => (b.por_usar - a.por_usar) || (b.n - a.n) || String(b.ultimo).localeCompare(String(a.ultimo)));
  return j({ ok: true, cada: FIEL_CADA, pct: FIEL_PCT, clientes: lista,
             resumo: { clientes: lista.length, emitidos, usados, por_usar: emitidos - usados, descontado_cent: descontado } });
}

// Codigos promocionais que SO funcionam com um combo especifico (o combo
// individual). Qualquer outro codigo continua a nao acumular com combos.
const PROMO_COMBO_PERMITIDO = {
  RAYGANHOU: ['Combo Minha Fome, Minhas Regras'],
};

// Valor so das esfihas e bebidas (sem a taxa de entrega), para codigos de
// percentagem. Nunca excede total - taxa minima de entrega; o subtotal que o
// site envia so pode baixar este valor, nunca subi-lo.
function baseItensDoPedido(b, totalCent) {
  const taxaMin = b.modo === 'entrega' ? taxaEntregaAtual() : 0;
  let base = Math.max(0, totalCent - taxaMin);
  const sub = parseInt(b.subtotal_cent, 10);
  if (Number.isFinite(sub) && sub >= 0) base = Math.min(base, sub);
  return base;
}

function calcularDescontoPromo(linha, totalOriginalCent, nEsfihas, baseItensCent) {
  const minEsfihas = linha.min_esfihas || 0;
  if (minEsfihas > 0 && nEsfihas < minEsfihas) return null;
  // Codigos de percentagem (fidelidade): so sobre esfihas e bebidas.
  const pct = parseInt(linha.desconto_pct, 10) || 0;
  if (pct > 0) {
    const base = Math.max(0, Math.min(baseItensCent == null ? totalOriginalCent : baseItensCent, totalOriginalCent));
    return Math.min(totalOriginalCent, Math.round(base * pct / 100));
  }
  const descontoMaxCent = Math.max(0, parseInt(linha.desconto_cent, 10) || 0);
  if (linha.preco_fixo_cent != null && nEsfihas === minEsfihas) {
    const bruto = totalOriginalCent - linha.preco_fixo_cent;
    return Math.max(0, Math.min(bruto, descontoMaxCent, totalOriginalCent));
  }
  return Math.max(0, Math.min(descontoMaxCent, totalOriginalCent));
}

// Validacao "so de leitura" de um codigo promocional -- usada no site para
// dar feedback imediato ao cliente (nao consome o codigo; o consumo real so
// acontece quando o pedido e de facto criado, em novoPedido()).
async function validarPromo(request, env) {
  let b;
  try { b = await request.json(); } catch (e) { return j({ ok: false, erro: 'corpo invalido' }, 400); }
  const codigo = String(b.codigo || '').trim().toUpperCase();
  if (!codigo) return j({ ok: false, erro: 'codigo em falta' }, 400);
  await garantirFidelidade(env);
  const linha = await env.DB.prepare('SELECT * FROM codigos_promo WHERE codigo = ?').bind(codigo).first();
  if (!linha) return j({ ok: false, erro: 'invalido' }, 404);
  if ((linha.usos_contagem || 0) >= (linha.usos_max || 1)) return j({ ok: false, erro: 'usado' }, 409);
  if (linha.tipo === 'fidelidade' && chaveTelefone(b.telefone) !== linha.telefone) {
    return j({ ok: false, erro: 'telefone' }, 409);
  }
  const totalCent = Math.max(0, parseInt(b.total_cent, 10) || 0);
  const nEsfihas = Math.max(0, parseInt(b.n_esfihas, 10) || 0);
  const desconto = calcularDescontoPromo(linha, totalCent, nEsfihas, baseItensDoPedido(b, totalCent));
  if (desconto === null) {
    return j({ ok: false, erro: 'minimo_esfihas', min_esfihas: linha.min_esfihas || 0 }, 400);
  }
  return j({ ok: true, desconto_cent: desconto, toda: linha.tipo === 'toda' ? 1 : 0 });
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
  'A Clássica', 'A Italiana',
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

// Fecho de caixa: o Miguel confirma manualmente, por dia, quanto recebeu
// mesmo em dinheiro/MB Way e quanto deu a serio a Andreza -- os valores
// "esperados" (calculados a partir dos pedidos) sao so uma sugestao
// mostrada no browser (igual a logica ja usada em Recibos do dia); aqui
// so se guarda o que o Miguel confirma, nunca se calcula nada sozinho.
// ---------------------------------------------------------------------------
// Contas do negocio: saldos de dinheiro vivo e MB/banco. As vendas entram
// sozinhas a partir dos fechos de caixa (dinheiro e MB confirmados; o valor
// dado ao estafeta sai do dinheiro vivo). Tudo o resto (ordenados, compras,
// publicidade, depositos, acertos...) e registado a mao em `movimentos`,
// com o valor em dinheiro e/ou MB (positivo = entra, negativo = sai).
// ---------------------------------------------------------------------------
const CATEGORIAS_CONTAS = new Set(['ordenado', 'ingredientes', 'publicidade', 'embalagens', 'equipamento', 'contas',
  'outra_saida', 'levantamento', 'entrada_pessoal', 'outra_entrada', 'deposito', 'levantei', 'acerto', 'inicio', 'reserva', 'estafeta_mb']);
// Categorias que sao despesas do negocio (contam para o resultado do mes).
const CATEGORIAS_DESPESA = new Set(['ordenado', 'ingredientes', 'publicidade', 'embalagens', 'equipamento', 'contas', 'outra_saida', 'reserva']);
let contasOk = false;
async function garantirContas(env) {
  if (contasOk) return;
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS movimentos (
       id INTEGER PRIMARY KEY AUTOINCREMENT, data TEXT NOT NULL, categoria TEXT NOT NULL, descricao TEXT,
       dinheiro_cent INTEGER NOT NULL DEFAULT 0, mb_cent INTEGER NOT NULL DEFAULT 0, criado_em TEXT NOT NULL)`
  ).run();
  contasOk = true;
}

async function listarContas(request, env) {
  await garantirContas(env);
  const url = new URL(request.url);
  let mes = (url.searchParams.get('mes') || '').trim();
  if (!/^\d{4}-\d{2}$/.test(mes)) mes = diaLisboa().slice(0, 7);
  const { results: fechos } = await env.DB.prepare(
    'SELECT dia, dinheiro_confirmado_cent AS din, mbway_confirmado_cent AS mb, andreza_confirmado_cent AS est FROM fecho_caixa ORDER BY dia'
  ).all();
  const { results: movs } = await env.DB.prepare('SELECT * FROM movimentos ORDER BY data, id').all();

  const meses = {};
  const M = m => meses[m] || (meses[m] = { mes: m, vendas_din: 0, vendas_mb: 0, estafeta: 0, dias: 0,
    despesas: 0, entradas_outras: 0, levantamentos: 0, entradas_pessoais: 0, acertos: 0,
    por_categoria: {}, fim_din: 0, fim_mb: 0 });
  for (const f of fechos || []) {
    const x = M(f.dia.slice(0, 7));
    x.vendas_din += f.din || 0; x.vendas_mb += f.mb || 0; x.estafeta += f.est || 0; x.dias += 1;
  }
  for (const v of movs || []) {
    const x = M(v.data.slice(0, 7));
    const tot = (v.dinheiro_cent || 0) + (v.mb_cent || 0);
    if (CATEGORIAS_DESPESA.has(v.categoria)) x.despesas += -tot;
    else if (v.categoria === 'outra_entrada') x.entradas_outras += tot;
    else if (v.categoria === 'levantamento') x.levantamentos += -tot;
    else if (v.categoria === 'entrada_pessoal') x.entradas_pessoais += tot;
    else if (v.categoria === 'acerto') x.acertos += tot;
    x.por_categoria[v.categoria] = (x.por_categoria[v.categoria] || 0) + tot;
  }
  // Saldos acumulados no fim de cada mes.
  const lista = Object.values(meses).sort((a, b) => a.mes.localeCompare(b.mes));
  const porMesDin = {}, porMesMb = {};
  for (const f of fechos || []) { const m = f.dia.slice(0, 7); porMesDin[m] = (porMesDin[m] || 0) + (f.din || 0) - (f.est || 0); porMesMb[m] = (porMesMb[m] || 0) + (f.mb || 0); }
  for (const v of movs || []) { const m = v.data.slice(0, 7); porMesDin[m] = (porMesDin[m] || 0) + (v.dinheiro_cent || 0); porMesMb[m] = (porMesMb[m] || 0) + (v.mb_cent || 0); }
  let din = 0, mb = 0;
  for (const x of lista) {
    din += porMesDin[x.mes] || 0; mb += porMesMb[x.mes] || 0;
    x.fim_din = din; x.fim_mb = mb;
    x.resultado = x.vendas_din + x.vendas_mb - x.estafeta - x.despesas + x.entradas_outras;
  }
  return j({ ok: true, mes, saldo_din: din, saldo_mb: mb, meses: lista,
             movimentos: (movs || []).filter(v => v.data.slice(0, 7) === mes) });
}

async function guardarMovimento(request, env) {
  await garantirContas(env);
  let b;
  try { b = await request.json(); } catch (e) { return j({ ok: false, erro: 'corpo invalido' }, 400); }
  const data = String(b.data || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return j({ ok: false, erro: 'data invalida' }, 400);
  const categoria = String(b.categoria || '');
  if (!CATEGORIAS_CONTAS.has(categoria)) return j({ ok: false, erro: 'categoria invalida' }, 400);
  const lim = v => { const n = Math.round(Number(v) || 0); return Math.max(-10000000, Math.min(10000000, n)); };
  const din = lim(b.dinheiro_cent), mbv = lim(b.mb_cent);
  if (!din && !mbv) return j({ ok: false, erro: 'valor em falta' }, 400);
  const descricao = String(b.descricao || '').trim().slice(0, 200);
  const idEditar = parseInt(b.id, 10);
  if (idEditar) {
    await env.DB.prepare('UPDATE movimentos SET data = ?, categoria = ?, descricao = ?, dinheiro_cent = ?, mb_cent = ? WHERE id = ?')
      .bind(data, categoria, descricao, din, mbv, idEditar).run();
    return j({ ok: true, id: idEditar });
  }
  const r = await env.DB.prepare(
    'INSERT INTO movimentos (data, categoria, descricao, dinheiro_cent, mb_cent, criado_em) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(data, categoria, descricao, din, mbv, new Date().toISOString()).run();
  return j({ ok: true, id: r.meta && r.meta.last_row_id });
}

async function apagarMovimento(request, env) {
  await garantirContas(env);
  let b;
  try { b = await request.json(); } catch (e) { return j({ ok: false, erro: 'corpo invalido' }, 400); }
  const id = parseInt(b.id, 10);
  if (!id) return j({ ok: false, erro: 'id em falta' }, 400);
  await env.DB.prepare('DELETE FROM movimentos WHERE id = ?').bind(id).run();
  return j({ ok: true });
}

async function listarFechoCaixa(request, env) {
  const url = new URL(request.url);
  const dia = (url.searchParams.get('dia') || '').trim();
  if (dia) {
    const linha = await env.DB.prepare('SELECT * FROM fecho_caixa WHERE dia = ?').bind(dia).first();
    return j({ ok: true, fecho: linha || null });
  }
  const diasN = Math.min(366, Math.max(1, parseInt(url.searchParams.get('dias'), 10) || 30));
  const { results } = await env.DB.prepare(
    'SELECT * FROM fecho_caixa ORDER BY dia DESC LIMIT ?'
  ).bind(diasN).all();
  const historico = results || [];

  // Custo de ingredientes por dia (mesma logica da Analise: sabores, extras,
  // bebidas, caixas de pizza, lima e ofertas fixas como o ketchup), so para
  // os dias que aparecem no historico -- assim a coluna "Resultado" ja vem
  // com o lucro real, sem o utilizador ter de ir calcular a parte.
  if (historico.length) {
    const diasOrdenados = historico.map(f => f.dia).sort();
    const diaMin = diasOrdenados[0];
    const diaMax = diasOrdenados[diasOrdenados.length - 1];

    const { results: custosRows } = await env.DB.prepare('SELECT produto, custo_cent FROM custos').all();
    const custos = {};
    for (const c of custosRows || []) custos[c.produto] = c.custo_cent || 0;

    const { results: stockBebidas } = await env.DB.prepare(
      'SELECT nome, por_pedido FROM stock_bebidas WHERE por_pedido > 0'
    ).all();

    const { results: linhas } = await env.DB.prepare(
      `SELECT dia, n_esfihas, itens FROM pedidos
        WHERE ensaio = 0 AND estado <> 'cancelado' AND dia >= ? AND dia <= ?`
    ).bind(diaMin, diaMax).all();

    const porDia = {};
    for (const r of linhas || []) {
      const d = porDia[r.dia] || (porDia[r.dia] = { custoProdutos: 0, pedidos: 0 });
      d.pedidos++;
      if (r.n_esfihas > 0) {
        const caixasPedido = Math.ceil(r.n_esfihas / 10);
        d.custoProdutos += caixasPedido * (custos['Caixa de pizza'] || 0);
        const fracaoLima = r.n_esfihas > 10 ? 0.5 : 0.25;
        d.custoProdutos += fracaoLima * (custos['Lima'] || 0);
      }
      let it = null;
      try { it = JSON.parse(r.itens || 'null'); } catch (e) {}
      if (it && !Array.isArray(it)) {
        for (const x of it.producao || []) {
          d.custoProdutos += (custos[x.sabor] || 0) * (x.n || 0);
          for (const e of x.extras || []) d.custoProdutos += (custos[e] || 0) * (x.n || 0);
        }
        for (const b of it.bebidas || []) d.custoProdutos += (custos[b.nome] || 0) * (b.n || 0);
      }
    }
    for (const dKey of Object.keys(porDia)) {
      for (const o of stockBebidas || []) {
        porDia[dKey].custoProdutos += (custos[o.nome] || 0) * o.por_pedido * porDia[dKey].pedidos;
      }
    }

    for (const f of historico) {
      f.ingredientes_cent = Math.round((porDia[f.dia] && porDia[f.dia].custoProdutos) || 0);
    }
  }

  return j({ ok: true, historico });
}

async function guardarFechoCaixa(request, env) {
  let b;
  try { b = await request.json(); } catch (e) { return j({ ok: false, erro: 'corpo invalido' }, 400); }
  const dia = limpar(b.dia, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia || '')) return j({ ok: false, erro: 'dia invalido' }, 400);
  const dinheiroCent = Math.max(0, parseInt(b.dinheiro_cent, 10) || 0);
  const mbwayCent = Math.max(0, parseInt(b.mbway_cent, 10) || 0);
  const andrezaCent = Math.max(0, parseInt(b.andreza_cent, 10) || 0);
  // Horas trabalhadas pelo Miguel (10e/h) e custos extra do dia (ex.: eletricidade),
  // guardados para o calculo de lucro/prejuizo do dia na pagina de Caixa.
  const horasCentesimos = Math.max(0, Math.round((parseFloat(b.horas_trabalhadas) || 0) * 100));
  const custoExtraCent = Math.max(0, parseInt(b.custo_extra_cent, 10) || 0);
  const notas = limpar(b.notas, 500) || null;
  const agora = new Date().toISOString();

  await env.DB.prepare(
    `INSERT INTO fecho_caixa (dia, dinheiro_confirmado_cent, mbway_confirmado_cent, andreza_confirmado_cent, horas_trabalhadas_centesimos, custo_extra_cent, notas, confirmado_em)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(dia) DO UPDATE SET
       dinheiro_confirmado_cent = excluded.dinheiro_confirmado_cent,
       mbway_confirmado_cent = excluded.mbway_confirmado_cent,
       andreza_confirmado_cent = excluded.andreza_confirmado_cent,
       horas_trabalhadas_centesimos = excluded.horas_trabalhadas_centesimos,
       custo_extra_cent = excluded.custo_extra_cent,
       notas = excluded.notas,
       confirmado_em = excluded.confirmado_em`
  ).bind(dia, dinheiroCent, mbwayCent, andrezaCent, horasCentesimos, custoExtraCent, notas, agora).run();

  const linha = await env.DB.prepare('SELECT * FROM fecho_caixa WHERE dia = ?').bind(dia).first();
  return j({ ok: true, fecho: linha });
}

// Registo de seguranca alimentar (temperaturas) -- o cron diario
// (scheduled()) preenche sozinho cada dia novo com os valores padrao reais
// (TEMP_PADRAO_*), sem o Miguel ter de escrever nada. So fica "auto=0"
// (corrigido a mao) quando ele edita um dia porque notou uma diferenca
// real -- o cron nunca sobrescreve um dia ja preenchido (ON CONFLICT DO
// NOTHING), e a edicao manual atualiza esse mesmo dia marcando auto=0.
async function preencherTemperaturaPadrao(env) {
  const dia = diaLisboa();
  const agora = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO registo_temperaturas (dia, frigorifico_c, congelador_c, confirmado_por, notas, auto, criado_em)
     VALUES (?, ?, ?, NULL, NULL, 1, ?)
     ON CONFLICT(dia) DO NOTHING`
  ).bind(dia, TEMP_PADRAO_FRIGORIFICO_C, TEMP_PADRAO_CONGELADOR_C, agora).run();
}

// Preenche de uma vez o historico de temperaturas desde o inicio do
// negocio (11 de outubro de 2026, pedido pelo Miguel em 2026-11-01) ate
// hoje, com os valores padrao -- so para os dias que ainda nao existem na
// tabela (ON CONFLICT DO NOTHING), nunca sobrescreve um dia ja preenchido
// pelo cron ou corrigido a mao. Chamado uma vez a partir do painel
// (botao "Preencher historico"), nao corre sozinho.
const INICIO_NEGOCIO_DIA = '2026-10-11';

async function preencherHistoricoTemperaturas(request, env) {
  const hoje = diaLisboa();
  const lote = [];
  const agora = new Date().toISOString();
  let d = new Date(INICIO_NEGOCIO_DIA + 'T12:00:00Z');
  const fim = new Date(hoje + 'T12:00:00Z');
  let dias = 0;
  while (d.getTime() <= fim.getTime() && dias < 400) {
    const diaStr = diaLisboa(d);
    lote.push(env.DB.prepare(
      `INSERT INTO registo_temperaturas (dia, frigorifico_c, congelador_c, confirmado_por, notas, auto, criado_em)
       VALUES (?, ?, ?, NULL, NULL, 1, ?)
       ON CONFLICT(dia) DO NOTHING`
    ).bind(diaStr, TEMP_PADRAO_FRIGORIFICO_C, TEMP_PADRAO_CONGELADOR_C, agora));
    d = new Date(d.getTime() + 86400000);
    dias++;
  }
  if (lote.length) await env.DB.batch(lote);
  return j({ ok: true, dias_preenchidos: dias });
}

async function listarTemperaturas(request, env) {
  const url = new URL(request.url);
  const diasN = Math.min(366, Math.max(1, parseInt(url.searchParams.get('dias'), 10) || 60));
  const { results } = await env.DB.prepare(
    'SELECT * FROM registo_temperaturas ORDER BY dia DESC LIMIT ?'
  ).bind(diasN).all();
  return j({
    ok: true,
    historico: results || [],
    padrao: { frigorifico_c: TEMP_PADRAO_FRIGORIFICO_C, congelador_c: TEMP_PADRAO_CONGELADOR_C },
  });
}

async function guardarTemperatura(request, env) {
  let b;
  try { b = await request.json(); } catch (e) { return j({ ok: false, erro: 'corpo invalido' }, 400); }
  const dia = limpar(b.dia, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia || '')) return j({ ok: false, erro: 'dia invalido' }, 400);
  const frigorifico = parseFloat(b.frigorifico_c);
  const congelador = parseFloat(b.congelador_c);
  if (!Number.isFinite(frigorifico) || !Number.isFinite(congelador)) {
    return j({ ok: false, erro: 'temperatura invalida' }, 400);
  }
  const notas = limpar(b.notas, 500) || null;
  const agora = new Date().toISOString();

  await env.DB.prepare(
    `INSERT INTO registo_temperaturas (dia, frigorifico_c, congelador_c, confirmado_por, notas, auto, criado_em)
     VALUES (?, ?, ?, 'Miguel', ?, 0, ?)
     ON CONFLICT(dia) DO UPDATE SET
       frigorifico_c = excluded.frigorifico_c,
       congelador_c = excluded.congelador_c,
       confirmado_por = excluded.confirmado_por,
       notas = excluded.notas,
       auto = 0,
       criado_em = excluded.criado_em`
  ).bind(dia, frigorifico, congelador, notas, agora).run();

  const linha = await env.DB.prepare('SELECT * FROM registo_temperaturas WHERE dia = ?').bind(dia).first();
  return j({ ok: true, registo: linha });
}

async function listarRastreabilidade(request, env) {
  const url = new URL(request.url);
  const diasN = Math.min(366, Math.max(1, parseInt(url.searchParams.get('dias'), 10) || 90));
  const corte = diaLisboa(new Date(Date.now() - diasN * 86400000));
  const { results } = await env.DB.prepare(
    'SELECT * FROM registo_rastreabilidade WHERE data_compra >= ? ORDER BY data_compra DESC, id DESC'
  ).bind(corte).all();
  return j({ ok: true, lista: results || [] });
}

async function guardarRastreabilidade(request, env) {
  let b;
  try { b = await request.json(); } catch (e) { return j({ ok: false, erro: 'corpo invalido' }, 400); }
  const dataCompra = limpar(b.data_compra, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dataCompra || '')) return j({ ok: false, erro: 'data invalida' }, 400);
  const produto = limpar(b.produto, 120);
  if (!produto) return j({ ok: false, erro: 'produto obrigatorio' }, 400);
  const fornecedor = limpar(b.fornecedor, 120) || null;
  const numeroFatura = limpar(b.numero_fatura, 60) || null;
  const validade = limpar(b.validade, 10) || null;
  const agora = new Date().toISOString();

  await env.DB.prepare(
    `INSERT INTO registo_rastreabilidade (data_compra, produto, fornecedor, numero_fatura, validade, criado_em)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(dataCompra, produto, fornecedor, numeroFatura, validade, agora).run();

  return await listarRastreabilidade(request, env);
}

async function analise(request, env) {
  const url = new URL(request.url);
  const { de, ate } = intervalo(url);

  const { results: linhas } = await env.DB.prepare(
    `SELECT dia, criado_em, modo, localidade, origem, total_cent, n_esfihas, itens, pago
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
  let receita = 0, receitaPaga = 0, receitaPorConfirmar = 0, pedidosPorConfirmar = 0, esfihas = 0, esfihasGratis = 0, entregas = 0, receitaEntregas = 0;
  let custoProdutos = 0, entregaCobrada = 0, entregaCustoUber = 0;

  for (const r of linhas || []) {
    receita += r.total_cent || 0;
    if (r.pago) { receitaPaga += r.total_cent || 0; } else { receitaPorConfirmar += r.total_cent || 0; pedidosPorConfirmar++; }
    esfihas += r.n_esfihas || 0;
    if (r.modo === 'entrega') { entregas++; receitaEntregas += r.total_cent || 0; }

    // Caixas de pizza usadas neste pedido: cada caixa leva ate 10 esfihas
    // (1 caixa ate 10, 2 caixas de 11 a 20, 3 caixas de 21 a 30, etc.). So
    // entra na conta se o custo da caixa estiver preenchido em Analise ->
    // Custos (produto "Caixa de pizza").
    if (r.n_esfihas > 0) {
      const caixasPedido = Math.ceil(r.n_esfihas / 10);
      custoProdutos += caixasPedido * (custos['Caixa de pizza'] || 0);
    }

    // Lima: vai sempre meia lima em pedidos com mais de 10 esfihas, um
    // quarto de lima em pedidos com 10 ou menos. O custo em "Lima" (em
    // Analise -> Custos) deve ser o preco de UMA lima inteira (ex.: saco de
    // 3,99 EUR com 12 limas -> custo da lima = 3,99 / 12).
    if (r.n_esfihas > 0) {
      const fracaoLima = r.n_esfihas > 10 ? 0.5 : 0.25;
      custoProdutos += fracaoLima * (custos['Lima'] || 0);
    }

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
        esfihasGratis += x.gratis || 0;
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
  // Ketchup e outras ofertas fixas por pedido (saem sempre, nao vem no
  // "itens" de nenhum pedido) -- custo entra aqui se tiver preco definido
  // em Custos com o mesmo nome do stock (ex.: "Ketchup (saquetas)").
  for (const o of ofertasFixas) custoProdutos += (custos[o.nome] || 0) * o.n;

  return j({
    ok: true, de, ate,
    resumo: { pedidos, receita, receitaPaga, receitaPorConfirmar, pedidosPorConfirmar, esfihas, esfihasPagas: esfihas - esfihasGratis, esfihasGratis, entregas, receitaEntregas, retiradas: pedidos - entregas, medio: pedidos ? receita / pedidos : 0 },
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
    const resp = await handleRequest(request, env, ctx);
    return comHeadersSeguranca(resp);
  },
  // Miguel decidiu em 2026-10-24: os dados dos pedidos ficam guardados
  // no maximo 13 meses (prazo de conservacao RGPD, igual ao escrito na
  // politica de privacidade do site). Corre uma vez por dia (ver
  // "triggers.crons" em wrangler.jsonc) -- precisa de um deploy via
  // wrangler para o cron ficar mesmo ativo na Cloudflare, um simples
  // push ao GitHub pode nao bastar.
  async scheduled(event, env, ctx) {
    await apagarPedidosAntigos(env);
    await preencherTemperaturaPadrao(env);
  },
};

// Apaga pedidos reais (ensaio=0) com mais de 13 meses -- prazo de
// conservacao de dados definido pelo Miguel em 2026-10-24. Os pedidos de
// ensaio tem o seu proprio apagamento manual (limparEnsaio), nao entram
// aqui.
async function apagarPedidosAntigos(env) {
  const corte = new Date();
  corte.setMonth(corte.getMonth() - 13);
  const corteIso = corte.toISOString();
  await env.DB.prepare('DELETE FROM pedidos WHERE ensaio = 0 AND criado_em < ?').bind(corteIso).run();
}

// Cabecalhos de seguranca basicos, aplicados a toda a resposta (paginas e
// API). CSP fica de fora de proposito -- o painel usa onclick inline em
// varios sitios e uma CSP mal afinada parte esses botoes sem se poder
// testar em producao; a via mais segura e configurar a CSP na Cloudflare
// (Regras > Transformar Regras > Modificar Cabecalho de Resposta), onde da
// para desligar num segundo se algo partir.
function comHeadersSeguranca(resp) {
  const h = new Headers(resp.headers);
  h.set('X-Content-Type-Options', 'nosniff');
  h.set('X-Frame-Options', 'DENY');
  h.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  h.set('Permissions-Policy', 'geolocation=(), camera=(), microphone=(), payment=()');
  h.set('Strict-Transport-Security', 'max-age=31536000');
  return new Response(resp.body, { status: resp.status, statusText: resp.statusText, headers: h });
}

async function handleRequest(request, env, ctx) {
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
      if (p === '/api/novidade' && request.method === 'GET') {
        return await novidadesPublicas(request, env);
      }
      if (p === '/api/stock-bebidas' && request.method === 'GET') {
        return await stockPublicoBebidas(request, env);
      }
      if (p === '/api/validar-promo' && request.method === 'POST') {
        return await validarPromo(request, env);
      }
      if (p === '/api/cotacao' && request.method === 'POST') {
        return await cotacao(request, env);
      }

      if (p.startsWith('/api/painel/')) {
        if (!autorizado(request, env)) return j({ ok: false, erro: 'nao autorizado' }, 401);
        if (p === '/api/painel/pedidos' && request.method === 'GET') return await listar(request, env);
        if (p === '/api/painel/pedido' && request.method === 'POST') return await mudarPedido(request, env);
        if (p === '/api/painel/pedido-item' && request.method === 'POST') return await adicionarItemPedido(request, env);
        if (p === '/api/painel/pedido-item-acrescentado' && request.method === 'POST') return await ajustarItemAcrescentado(request, env);
        if (p === '/api/painel/pedido-producao-oferta' && request.method === 'POST') return await marcarOfertaProducao(request, env);
        if (p === '/api/painel/pedido-total' && request.method === 'POST') return await corrigirTotalPedido(request, env);
        if (p === '/api/painel/pedido-telefone' && request.method === 'POST') return await corrigirTelefonePedido(request, env);
        if (p === '/api/painel/fidelidade' && request.method === 'GET') return await listarFidelidade(request, env);
        if (p === '/api/painel/pedidos-cliente' && request.method === 'GET') return await pedidosDoCliente(request, env);
        if (p === '/api/painel/fidelidade-apagar' && request.method === 'POST') return await apagarCodigoFiel(request, env);
        if (p === '/api/painel/pedido-producao-ajustar' && request.method === 'POST') return await ajustarProducaoPedido(request, env);
        if (p === '/api/painel/pedido-producao-adicionar' && request.method === 'POST') return await adicionarProducaoPedido(request, env);
        if (p === '/api/painel/congelados' && request.method === 'POST') return await criarEncomendaCongelados(request, env);
        if (p === '/api/painel/pedido-oferta-bebida' && request.method === 'POST') return await resolverOfertaBebida(request, env);
        if (p === '/api/painel/stock' && request.method === 'POST') return await mudarStock(request, env);
        if (p === '/api/painel/limpar-ensaio' && request.method === 'POST') return await limparEnsaio(request, env);
        if (p === '/api/painel/analise' && request.method === 'GET') return await analise(request, env);
        if (p === '/api/painel/fecho-caixa' && request.method === 'GET') return await listarFechoCaixa(request, env);
        if (p === '/api/painel/contas' && request.method === 'GET') return await listarContas(request, env);
        if (p === '/api/painel/contas/movimento' && request.method === 'POST') return await guardarMovimento(request, env);
        if (p === '/api/painel/contas/apagar' && request.method === 'POST') return await apagarMovimento(request, env);
        if (p === '/api/painel/fecho-caixa' && request.method === 'POST') return await guardarFechoCaixa(request, env);
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
        if (p === '/api/painel/seguranca-temperaturas' && request.method === 'GET') return await listarTemperaturas(request, env);
        if (p === '/api/painel/seguranca-temperaturas-historico' && request.method === 'POST') return await preencherHistoricoTemperaturas(request, env);
        if (p === '/api/painel/seguranca-temperaturas' && request.method === 'POST') return await guardarTemperatura(request, env);
        if (p === '/api/painel/seguranca-rastreabilidade' && request.method === 'GET') return await listarRastreabilidade(request, env);
        if (p === '/api/painel/seguranca-rastreabilidade' && request.method === 'POST') return await guardarRastreabilidade(request, env);
      }

      return j({ ok: false, erro: 'nao existe' }, 404);
    } catch (e) {
      return j({ ok: false, erro: 'falha no servidor', detalhe: String(e && e.message || e) }, 500);
    }
}
