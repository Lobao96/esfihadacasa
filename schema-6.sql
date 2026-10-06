-- Esfiha da Casa — stock das esfihas salgadas (recheadas e congeladas,
-- prontas a ir ao forno). As doces não entram aqui: são feitas por
-- encomenda (massa crua, pré-cozida e só depois rechear), por isso só
-- fazem sentido na análise de vendas, não como stock parado.
-- quantidade = quantas esfihas há agora congeladas, por sabor.
CREATE TABLE IF NOT EXISTS stock_salgadas (
  nome          TEXT PRIMARY KEY,
  quantidade    INTEGER NOT NULL DEFAULT 0,
  minimo        INTEGER NOT NULL DEFAULT 0,
  atualizado_em TEXT
);

-- Semeia com os 4 sabores salgados do cardápio atual, quantidade a 0 —
-- o utilizador preenche as quantidades reais diretamente no painel.
INSERT OR IGNORE INTO stock_salgadas (nome, quantidade, minimo, atualizado_em) VALUES
  ('A Tradicional', 0, 0, datetime('now')),
  ('A Suculenta',   0, 0, datetime('now')),
  ('A Caipira',     0, 0, datetime('now')),
  ('A Queridinha',  0, 0, datetime('now'));
