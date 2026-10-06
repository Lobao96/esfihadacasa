-- Correção pontual: nenhuma venda real aconteceu ainda (loja em testes),
-- por isso é seguro repor as bebidas nos valores reais da fatura de
-- 26/09, que ficaram desfasados por causa do bug do "Apagar ensaios"
-- (versões antigas de pedidos de teste já apagados, sem registo para
-- devolver automaticamente).
UPDATE stock_bebidas SET quantidade = 28, atualizado_em = datetime('now') WHERE nome = 'Coca-Cola';
UPDATE stock_bebidas SET quantidade = 12, atualizado_em = datetime('now') WHERE nome = 'Coca-Cola 1L';
UPDATE stock_bebidas SET quantidade = 28, atualizado_em = datetime('now') WHERE nome = 'Coca-Cola Zero';
UPDATE stock_bebidas SET quantidade = 28, atualizado_em = datetime('now') WHERE nome = 'Fanta Laranja';
UPDATE stock_bebidas SET quantidade = 0,  atualizado_em = datetime('now') WHERE nome = 'Fanta Laranja 1L';
UPDATE stock_bebidas SET quantidade = 24, atualizado_em = datetime('now') WHERE nome = 'Guaraná';
UPDATE stock_bebidas SET quantidade = 24, atualizado_em = datetime('now') WHERE nome = 'Iced Tea Pêssego';
UPDATE stock_bebidas SET quantidade = 24, atualizado_em = datetime('now') WHERE nome = 'Água';
UPDATE stock_bebidas SET quantidade = 200, atualizado_em = datetime('now') WHERE nome = 'Ketchup (saquetas)';

-- Repete a limpeza do schema-7: os 3 sabores doces voltaram a aparecer
-- (uma página antiga em cache recriou-os ao guardar uma quantidade).
DELETE FROM stock_salgadas
 WHERE nome IN ('A Que Todo Mundo Ama', 'A Irresistível', 'A Diferentona');
