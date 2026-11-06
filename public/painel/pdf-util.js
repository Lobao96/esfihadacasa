/* Helpers para gerar PDFs A4 no browser (jsPDF) e guardar logo, sem passar pelo
   dialogo de impressao. Usado por Recibos e Caixa. Carregar depois de jspdf.umd.min.js. */
(function () {
  'use strict';
  var VERMELHO = [200, 35, 43], TINTA = [58, 31, 18], CINZA = [107, 74, 56], LINHA = [226, 214, 200];
  var MX = 15, LARG = 210, ALT = 297, UTIL = LARG - 2 * MX;

  // helvetica (WinAnsi) nao tem emojis: tira o que nao se consegue desenhar
  function limpa(t) {
    return String(t == null ? '' : t).replace(/\u2212/g, '-')
      .replace(/[^ -~ -ÿ€–—‘’“”•]/g, '')
      .replace(/\s+/g, ' ').trim();
  }

  function carregarLogo() {
    return fetch('/icon-512.png').then(function (r) { return r.blob(); }).then(function (b) {
      return new Promise(function (ok) {
        var fr = new FileReader();
        fr.onload = function () { ok(fr.result); };
        fr.onerror = function () { ok(null); };
        fr.readAsDataURL(b);
      });
    }).catch(function () { return null; });
  }

  function Ctx(doc, logo, titulo, sub) { this.doc = doc; this.logo = logo; this.titulo = titulo; this.sub = sub || ''; this.y = 0; this.pagina = 1; }

  Ctx.prototype.cabecalho = function (completo) {
    var d = this.doc;
    if (completo) {
      if (this.logo) { try { d.addImage(this.logo, 'PNG', MX, 12, 15, 15); } catch (e) {} }
      d.setTextColor.apply(d, TINTA); d.setFont('helvetica', 'bold'); d.setFontSize(17);
      d.text('Esfiha da Casa', MX + 19, 18);
      d.setFontSize(11); d.text(limpa(this.titulo), MX + 19, 24.5);
      d.setFont('helvetica', 'normal'); d.setFontSize(8); d.setTextColor.apply(d, CINZA);
      d.text(limpa(this.sub), MX + 19, 29.5);
      d.setDrawColor.apply(d, VERMELHO); d.setLineWidth(0.6); d.line(MX, 33, LARG - MX, 33);
      this.y = 40;
    } else {
      d.setFont('helvetica', 'bold'); d.setFontSize(9); d.setTextColor.apply(d, CINZA);
      d.text('Esfiha da Casa — ' + limpa(this.titulo), MX, 12);
      d.setDrawColor.apply(d, VERMELHO); d.setLineWidth(0.4); d.line(MX, 14, LARG - MX, 14);
      this.y = 21;
    }
  };

  Ctx.prototype.novaPagina = function () {
    this.doc.addPage(); this.pagina++; this.cabecalho(false);
  };
  Ctx.prototype.precisa = function (h) {
    if (this.y + h > ALT - 18) { this.novaPagina(); return true; }
    return false;
  };
  Ctx.prototype.forcaNova = function () { this.novaPagina(); };

  Ctx.prototype.titulo2 = function (t, cor) {
    var d = this.doc; this.precisa(12);
    d.setFont('helvetica', 'bold'); d.setFontSize(12); d.setTextColor.apply(d, cor || TINTA);
    d.text(limpa(t), MX, this.y); this.y += 7;
  };
  Ctx.prototype.texto = function (t, opts) {
    opts = opts || {};
    var d = this.doc;
    d.setFont('helvetica', opts.bold ? 'bold' : 'normal'); d.setFontSize(opts.size || 9.5);
    d.setTextColor.apply(d, opts.cor || TINTA);
    var linhas = d.splitTextToSize(limpa(t), opts.larg || UTIL);
    var lh = (opts.size || 9.5) * 0.5;
    this.precisa(linhas.length * lh + 1);
    d.text(linhas, opts.x != null ? opts.x : MX, this.y);
    this.y += linhas.length * lh + (opts.depois != null ? opts.depois : 1.5);
  };

  // resumo: lista de [valor, rotulo] em N colunas
  Ctx.prototype.resumo = function (itens, colunas) {
    var d = this.doc; colunas = colunas || 4;
    var lin = Math.ceil(itens.length / colunas), w = UTIL / colunas, h = 13;
    this.precisa(lin * h + 4);
    d.setDrawColor.apply(d, LINHA); d.setLineWidth(0.3); d.roundedRect(MX, this.y - 4, UTIL, lin * h + 2, 2, 2);
    itens.forEach(function (it, i) {
      var cx = MX + 3 + (i % colunas) * w, cy = this.y + 2 + Math.floor(i / colunas) * h;
      d.setFont('helvetica', 'bold'); d.setFontSize(11); d.setTextColor.apply(d, TINTA); d.text(limpa(it[0]), cx, cy);
      d.setFont('helvetica', 'normal'); d.setFontSize(7.5); d.setTextColor.apply(d, CINZA); d.text(limpa(it[1]), cx, cy + 4);
    }, this);
    this.y += lin * h + 4;
  };

  // aviso colorido: caixa com texto
  Ctx.prototype.aviso = function (t, cor) {
    var d = this.doc;
    var linhas = d.splitTextToSize(limpa(t), UTIL - 8);
    var h = linhas.length * 4.6 + 5;
    this.precisa(h + 3);
    d.setDrawColor.apply(d, cor); d.setLineWidth(0.5); d.roundedRect(MX, this.y - 3.5, UTIL, h, 2, 2);
    d.setFont('helvetica', 'bold'); d.setFontSize(10); d.setTextColor.apply(d, cor);
    d.text(linhas, MX + 4, this.y + 1);
    this.y += h + 3;
  };

  // cols: [{h:'Dia', w:40, a:'l'|'r'}], rows: [[..],..], opts: {totalRow: [...]}
  Ctx.prototype.tabela = function (cols, rows, opts) {
    opts = opts || {};
    var d = this.doc, soma = cols.reduce(function (a, c) { return a + c.w; }, 0), esc = UTIL / soma, self = this;
    function cab() {
      self.precisa(14);
      d.setFont('helvetica', 'bold'); d.setFontSize(8); d.setTextColor.apply(d, CINZA);
      var x = MX; cols.forEach(function (c) { var w = c.w * esc; d.text(limpa(c.h), c.a === 'r' ? x + w - 1 : x + 1, self.y, { align: c.a === 'r' ? 'right' : 'left' }); x += w; });
      d.setDrawColor.apply(d, TINTA); d.setLineWidth(0.4); d.line(MX, self.y + 1.8, LARG - MX, self.y + 1.8);
      self.y += 6;
    }
    function linha(r, bold, topo) {
      var maxL = 1, partes = r.map(function (v, i) { var c = cols[i]; var L = d.splitTextToSize(limpa(v && v.t != null ? v.t : v), c.w * esc - 2); maxL = Math.max(maxL, L.length); return L; });
      var h = maxL * 4 + 2;
      if (self.y + h > ALT - 18) { self.novaPagina(); cab(); }
      if (topo) { d.setDrawColor.apply(d, TINTA); d.setLineWidth(0.4); d.line(MX, self.y - 3.5, LARG - MX, self.y - 3.5); }
      var x = MX;
      cols.forEach(function (c, i) {
        var w = c.w * esc, cor = (r[i] && r[i].cor) || TINTA;
        d.setFont('helvetica', (bold || (r[i] && r[i].b)) ? 'bold' : 'normal'); d.setFontSize(8.5); d.setTextColor.apply(d, cor);
        d.text(partes[i], c.a === 'r' ? x + w - 1 : x + 1, self.y, { align: c.a === 'r' ? 'right' : 'left' });
        x += w;
      });
      self.y += h;
      if (!topo) { d.setDrawColor.apply(d, LINHA); d.setLineWidth(0.2); d.line(MX, self.y - 2.8, LARG - MX, self.y - 2.8); }
    }
    cab();
    rows.forEach(function (r) { linha(r, false, false); });
    if (opts.totalRow) linha(opts.totalRow, true, true);
    this.y += 2;
  };

  // par rotulo ... valor alinhado a direita
  Ctx.prototype.par = function (rot, val, o) {
    o = o || {}; var d = this.doc; this.precisa(7);
    d.setFont('helvetica', o.bold ? 'bold' : 'normal'); d.setFontSize(o.size || 9.5); d.setTextColor.apply(d, o.cor || TINTA);
    d.text(limpa(rot), MX, this.y); d.text(limpa(val), LARG - MX, this.y, { align: 'right' });
    d.setDrawColor.apply(d, LINHA); d.setLineWidth(0.2); d.line(MX, this.y + 2, LARG - MX, this.y + 2);
    this.y += 6.5;
  };

  Ctx.prototype.guardar = function (nome) {
    var d = this.doc, n = d.getNumberOfPages();
    for (var i = 1; i <= n; i++) {
      d.setPage(i); d.setFont('helvetica', 'normal'); d.setFontSize(8); d.setTextColor.apply(d, CINZA);
      d.text('Esfiha da Casa · página ' + i + ' de ' + n, LARG / 2, ALT - 9, { align: 'center' });
    }
    d.save(nome);
  };

  window.PDFU = {
    VERMELHO: VERMELHO, TINTA: TINTA, CINZA: CINZA, VERDE: [30, 140, 70], AMBAR: [138, 90, 0],
    MX: MX, LARG: LARG, UTIL: UTIL, limpa: limpa,
    novo: function (titulo, sub) {
      return carregarLogo().then(function (logo) {
        var jsPDF = window.jspdf.jsPDF;
        var doc = new jsPDF({ unit: 'mm', format: 'a4' });
        var c = new Ctx(doc, logo, titulo, sub);
        c.cabecalho(true);
        return c;
      });
    },
  };
})();

/* Navegacao de datas sem escrever a mao: setas (dia anterior/seguinte) e
   seletor de mes com setas + listas de mes e ano. Funciona em qualquer
   browser (o <input type="month"> nao existe no Safari do computador). */
(function () {
  'use strict';
  var MESES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  var ESTILO = 'border:1.5px solid var(--line);background:transparent;border-radius:8px;padding:9px 12px;cursor:pointer;font-weight:800;font-family:inherit;color:var(--red);font-size:1rem;';
  var SEL = 'border:1.5px solid var(--line);border-radius:8px;padding:9px 8px;font-family:inherit;font-weight:700;font-size:0.95rem;background:#fff;color:inherit;';

  function mudaDia(inputId, delta, cb) {
    var el = document.getElementById(inputId); if (!el || !el.value) return;
    var p = el.value.split('-').map(Number);
    var d = new Date(Date.UTC(p[0], p[1] - 1, p[2] + delta));
    el.value = d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
    cb();
  }

  window.NAVD = {
    diaInit: function (inputId, cb) {
      var el = document.getElementById(inputId); if (!el || el.dataset.nav) return;
      el.dataset.nav = '1';
      var a = document.createElement('button'); a.type = 'button'; a.textContent = '◀'; a.title = 'Dia anterior'; a.style.cssText = ESTILO; a.onclick = function () { mudaDia(inputId, -1, cb); };
      var b = document.createElement('button'); b.type = 'button'; b.textContent = '▶'; b.title = 'Dia seguinte'; b.style.cssText = ESTILO; b.onclick = function () { mudaDia(inputId, 1, cb); };
      el.parentNode.insertBefore(a, el); el.parentNode.insertBefore(b, el.nextSibling);
    },
    // hiddenId: input hidden com o valor AAAA-MM; boxId: onde desenhar; cb: chamado ao mudar
    mesInit: function (hiddenId, boxId, cb, hojeMes) {
      var h = document.getElementById(hiddenId), box = document.getElementById(boxId);
      if (!h || !box || box.dataset.nav) return;
      box.dataset.nav = '1';
      var anoAtual = parseInt(hojeMes.slice(0, 4), 10);
      var anos = []; for (var y = 2026; y <= Math.max(anoAtual + 1, 2027); y++) anos.push(y);
      box.style.cssText = 'display:flex;gap:6px;align-items:center;flex-wrap:wrap';
      box.innerHTML = '<button type="button" style="' + ESTILO + '" data-d="-1" title="Mês anterior">◀</button>' +
        '<select data-k="m" style="' + SEL + '">' + MESES.map(function (n, i) { return '<option value="' + String(i + 1).padStart(2, '0') + '">' + n + '</option>'; }).join('') + '</select>' +
        '<select data-k="a" style="' + SEL + '">' + anos.map(function (y) { return '<option value="' + y + '">' + y + '</option>'; }).join('') + '</select>' +
        '<button type="button" style="' + ESTILO + '" data-d="1" title="Mês seguinte">▶</button>';
      var sm = box.querySelector('[data-k=m]'), sa = box.querySelector('[data-k=a]');
      function desdeSelects() { h.value = sa.value + '-' + sm.value; cb(); }
      sm.onchange = desdeSelects; sa.onchange = desdeSelects;
      box.querySelectorAll('button').forEach(function (bt) {
        bt.onclick = function () {
          var p = h.value.split('-').map(Number), d = new Date(Date.UTC(p[0], p[1] - 1 + parseInt(bt.dataset.d, 10), 1));
          NAVD.setMes(hiddenId, d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0')); cb();
        };
      });
      h._sinc = function () {
        if (!h.value) return;
        var a = h.value.slice(0, 4);
        if (!Array.prototype.some.call(sa.options, function (o) { return o.value === a; })) { var o = document.createElement('option'); o.value = a; o.textContent = a; sa.appendChild(o); }
        sa.value = a; sm.value = h.value.slice(5, 7);
      };
    },
    setMes: function (hiddenId, v) { var h = document.getElementById(hiddenId); h.value = v; if (h._sinc) h._sinc(); },
  };
})();
