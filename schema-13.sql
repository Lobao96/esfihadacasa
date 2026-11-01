-- Esfiha da Casa -- registo interno de seguranca alimentar (higiene e
-- producao), para ter pronto numa eventual inspecao e para organizar a
-- venda a grosso a cafes. Pedido pelo Miguel em 2026-11-01.
--
-- registo_temperaturas: um cron diario (ver preencherTemperaturaPadrao em
-- src/index.js, chamado no scheduled()) preenche sozinho cada dia novo com
-- os valores padrao reais do frigorifico/congelador (TEMP_PADRAO_*), sem o
-- Miguel ter de escrever nada. auto=1 = preenchido pelo cron; auto=0 =
-- corrigido a mao pelo Miguel porque notou uma diferenca real nesse dia.
CREATE TABLE IF NOT EXISTS registo_temperaturas (
  dia              TEXT PRIMARY KEY,   -- AAAA-MM-DD
  frigorifico_c    REAL NOT NULL,
  congelador_c     REAL NOT NULL,
  confirmado_por   TEXT,
  notas            TEXT,
  auto             INTEGER NOT NULL DEFAULT 1,
  criado_em        TEXT NOT NULL
);

-- registo_rastreabilidade: faturas/compras de materia-prima, para provar a
-- origem dos ingredientes se for preciso.
CREATE TABLE IF NOT EXISTS registo_rastreabilidade (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  data_compra      TEXT NOT NULL,      -- AAAA-MM-DD
  produto          TEXT NOT NULL,
  fornecedor       TEXT,
  numero_fatura    TEXT,
  validade         TEXT,
  criado_em        TEXT NOT NULL
);
