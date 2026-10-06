-- Esfiha da Casa — stock das bebidas, para saber quando comprar mais.
-- quantidade  = quantas garrafas/latas/saquetas há agora na loja.
-- minimo      = abaixo disto, o painel avisa que é preciso comprar mais.
-- por_pedido  = ofertas fixas que saem em TODOS os pedidos (ex.: saquetas
--               de ketchup), independentemente do que o cliente escolheu.
--               Para uma bebida normal fica a 0 — o consumo vem do que o
--               cliente escolheu (ou do brinde), não é fixo.
CREATE TABLE IF NOT EXISTS stock_bebidas (
  nome          TEXT PRIMARY KEY,
  quantidade    INTEGER NOT NULL DEFAULT 0,
  minimo        INTEGER NOT NULL DEFAULT 0,
  por_pedido    INTEGER NOT NULL DEFAULT 0,
  atualizado_em TEXT
);

-- Stock real da compra à Recheio de 26/09 (fatura enviada pelo dono) — a
-- loja ainda não tinha aberto nessa data, por isso é também o stock de
-- agora. Confirmado com o dono: Coca-Cola são 28 latas + 12 garrafas de 1L
-- (duas linhas distintas na fatura); a Fanta em lata (28) está confirmada,
-- só a Fanta de 1L é que ainda não foi comprada.
INSERT OR IGNORE INTO stock_bebidas (nome, quantidade, minimo, por_pedido, atualizado_em) VALUES
  ('Coca-Cola 1L',       12,  4, 0, datetime('now')),  -- pack 12 (fatura 26/09)
  ('Fanta Laranja 1L',   0,   4, 0, datetime('now')),  -- ainda não comprada
  ('Coca-Cola',          28,  7, 0, datetime('now')),  -- pack 28, lata 33cl (fatura 26/09)
  ('Coca-Cola Zero',     28,  7, 0, datetime('now')),  -- pack 28 (fatura 26/09)
  ('Fanta Laranja',      28,  7, 0, datetime('now')),  -- pack 28, lata 33cl (fatura 26/09) — confirmado
  ('Guaraná',            24,  6, 0, datetime('now')),  -- pack 24 (fatura 26/09)
  ('Iced Tea Pêssego',   24,  6, 0, datetime('now')),  -- pack 24, Lipton Pêssego (fatura 26/09)
  ('Água',               24,  6, 0, datetime('now')),  -- pack 24, Serra da Estrela 50cl (fatura 26/09)
  ('Ketchup (saquetas)', 200, 40, 2, datetime('now')); -- 200 saquetas (fatura 26/09), 2 saem por pedido
