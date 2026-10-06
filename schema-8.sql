-- Esfiha da Casa — nome do cliente, para o estafeta saber a quem entrega.
-- Passa a ser obrigatorio no checkout a partir de agora; pedidos antigos
-- ficam sem nome (NULL), o que e normal.
ALTER TABLE pedidos ADD COLUMN nome TEXT;
