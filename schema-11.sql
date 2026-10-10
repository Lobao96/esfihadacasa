-- Motivo do cancelamento de um pedido (falta de pagamento, esgotou, nao foi
-- possivel entregar, etc.) -- so para controlo interno, visivel no painel.
-- Pedidos antigos ficam com NULL.
ALTER TABLE pedidos ADD COLUMN motivo_cancelamento TEXT;
