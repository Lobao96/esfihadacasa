-- Esfiha da Casa — dois sabores salgados novos: A Clássica (fiambre e
-- queijo) e A Italiana (queijo, tomate e manjericão). Semeia o stock a 0 --
-- o utilizador preenche a quantidade real no painel.
INSERT OR IGNORE INTO stock_salgadas (nome, quantidade, minimo, atualizado_em) VALUES
  ('A Clássica', 0, 0, datetime('now')),
  ('A Italiana', 0, 0, datetime('now'));
