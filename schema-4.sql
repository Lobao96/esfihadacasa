-- Esfiha da Casa — custo estimado de cada produto, para o fecho de caixa.
-- "produto" e o mesmo nome usado na analise (sabor, extra ou bebida),
-- para nao precisar de mapear ids.
CREATE TABLE IF NOT EXISTS custos (
  produto    TEXT PRIMARY KEY,
  custo_cent INTEGER NOT NULL DEFAULT 0
);
