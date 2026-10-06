-- Esfiha da Casa — massa doce pronta (sem recheio). Ao contrário das
-- salgadas (por sabor, já recheadas e congeladas), as doces são feitas
-- por encomenda: só a massa fica pronta com antecedência, o recheio
-- escolhido pelo cliente é posto na hora. Por isso uma linha única,
-- sem nome de sabor.
CREATE TABLE IF NOT EXISTS stock_doces (
  id            INTEGER PRIMARY KEY CHECK (id = 1),
  quantidade    INTEGER NOT NULL DEFAULT 0,
  minimo        INTEGER NOT NULL DEFAULT 0,
  atualizado_em TEXT
);
INSERT OR IGNORE INTO stock_doces (id, quantidade, minimo, atualizado_em) VALUES (1, 0, 0, datetime('now'));
