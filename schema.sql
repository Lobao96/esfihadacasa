-- Esfiha da Casa — base de dados dos pedidos
CREATE TABLE IF NOT EXISTS pedidos (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  dia            TEXT    NOT NULL,          -- AAAA-MM-DD, hora de Lisboa
  numero         INTEGER NOT NULL,          -- fila do dia, começa no 1
  senha          TEXT,                      -- senha gerada no telemóvel do cliente
  ensaio         INTEGER NOT NULL DEFAULT 0,
  estado         TEXT    NOT NULL DEFAULT 'novo',  -- novo|preparacao|caminho|entregue|cancelado
  pago           INTEGER NOT NULL DEFAULT 0,
  stock_debitado INTEGER NOT NULL DEFAULT 0,
  modo           TEXT,                      -- entrega|retirada
  localidade     TEXT,
  morada         TEXT,
  total_cent     INTEGER DEFAULT 0,
  n_esfihas      INTEGER DEFAULT 0,
  itens          TEXT,                      -- JSON com as linhas do pedido
  mensagem       TEXT,                      -- a mensagem que foi para o WhatsApp
  criado_em      TEXT    NOT NULL,
  atualizado_em  TEXT
);
CREATE INDEX IF NOT EXISTS idx_pedidos_dia ON pedidos (dia, ensaio, numero);

CREATE TABLE IF NOT EXISTS stock (
  dia    TEXT PRIMARY KEY,
  total  INTEGER NOT NULL DEFAULT 0,   -- quantas esfihas foram feitas hoje
  usado  INTEGER NOT NULL DEFAULT 0,   -- quantas já foram confirmadas
  aberto INTEGER NOT NULL DEFAULT 1    -- 0 = loja fechada por hoje
);
