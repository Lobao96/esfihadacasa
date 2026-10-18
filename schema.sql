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
  desconto_cent   INTEGER NOT NULL DEFAULT 0,  -- desconto fixo (pedidos acima de min_esfihas); tambem serve de
                                                -- limite maximo de desconto quando preco_fixo_cent esta definido
  preco_fixo_cent INTEGER,                     -- se definido: quando o pedido tiver EXATAMENTE min_esfihas
                                                -- esfihas, o desconto ajusta-se sozinho para o total dar
                                                -- este valor (ate ao limite de desconto_cent)
  min_esfihas     INTEGER NOT NULL DEFAULT 0,  -- minimo de esfihas no pedido para o codigo ser valido (0 = sem minimo)
  usos_max        INTEGER NOT NULL DEFAULT 1,  -- quantas vezes pode ser usado no total (1 = uso unico, como antes)
  usos_contagem   INTEGER NOT NULL DEFAULT 0,  -- quantas vezes ja foi usado
  usado           INTEGER NOT NULL DEFAULT 0,  -- fica 1 so quando usos_contagem atinge usos_max (esgotado)
  usado_pedido_id INTEGER,                     -- id do ultimo pedido que o usou
  usado_em        TEXT,                        -- quando foi usado a ultima vez
  criado_em       TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS fecho_caixa (
  dia                           TEXT PRIMARY KEY,   -- AAAA-MM-DD
  dinheiro_confirmado_cent      INTEGER NOT NULL DEFAULT 0,  -- dinheiro que o Miguel confirma ter recebido mesmo
  mbway_confirmado_cent         INTEGER NOT NULL DEFAULT 0,  -- MB Way confirmado
  andreza_confirmado_cent       INTEGER NOT NULL DEFAULT 0,  -- valor dado a ela de verdade (0 se nao trabalhou nesse dia)
  horas_trabalhadas_centesimos  INTEGER NOT NULL DEFAULT 0,  -- horas do Miguel nesse dia x100 (ex.: 4,5h = 450); custo = horas x 10e/h
  custo_extra_cent              INTEGER NOT NULL DEFAULT 0,  -- eletricidade/outros custos fixos do dia
  notas                         TEXT,                        -- ex.: "ela nao veio", "faltam 13e a confirmar"
  confirmado_em                 TEXT    NOT NULL
);
