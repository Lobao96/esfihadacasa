-- Codigo LUANGEL: Combo individual + entrega gratis, uso unico, so para o telefone 964897315.
INSERT OR REPLACE INTO codigos_promo
  (codigo, descricao, desconto_cent, min_esfihas, usos_max, usos_contagem, usado, criado_em, tipo, telefone, desconto_pct)
VALUES
  ('LUANGEL', 'Combo individual + entrega gratis (so telefone 964897315)', 1200, 3, 1, 0, 0, strftime('%Y-%m-%dT%H:%M:%fZ','now'), 'premio', '964897315', 0);
