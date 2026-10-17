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
  dia           TEXT PRIMARY KEY,
  total         INTEGER NOT NULL DEFAULT 0,   -- quantas esfihas foram feitas hoje
  usado         INTEGER NOT NULL DEFAULT 0,   -- quantas já foram confirmadas
  aberto          INTEGER NOT NULL DEFAULT 1,   -- valor do override manual (só importa enquanto override_expira estiver no futuro)
  tem_override    INTEGER NOT NULL DEFAULT 0,   -- coluna antiga, sem uso (ver override_expira) -- mantida para não partir migrações já aplicadas
  override_expira TEXT                          -- instante (ISO, UTC) até quando o override de "aberto" vale; NULL = sem override, segue o horário automático. Expira na próxima abertura/fecho automático ou à meia-noite seguinte, o que vier primeiro.
);

CREATE TABLE IF NOT EXISTS codigos_promo (
  codigo          TEXT PRIMARY KEY,   -- sempre em maiusculas
  descricao       TEXT,
  desconto_cent   INTEGER NOT NULL DEFAULT 0,  -- desconto fixo, nunca o pedido todo gratis
  usado           INTEGER NOT NULL DEFAULT 0,
  usado_pedido_id INTEGER,
  usado_em        TEXT,
  criado_em       TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS fecho_caixa (
  dia                       TEXT PRIMARY KEY,   -- AAAA-MM-DD
  dinheiro_confirmado_cent  INTEGER NOT NULL DEFAULT 0,  -- dinheiro que o Miguel confirma ter recebido mesmo
  mbway_confirmado_cent     INTEGER NOT NULL DEFAULT 0,  -- MB Way confirmado
  andreza_confirmado_cent   INTEGER NOT NULL DEFAULT 0,  -- valor dado a ela de verdade (0 se nao trabalhou nesse dia)
  notas                     TEXT,                        -- ex.: "ela nao veio", "faltam 13e a confirmar"
  confirmado_em             TEXT    NOT NULL
);
