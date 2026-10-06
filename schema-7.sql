-- Correção: a migração 6 tinha apanhado por engano 3 sabores doces
-- (Nutella, goiabada, banana) a par dos salgados reais. Remove-os —
-- doces não têm stock por nome, só entram na análise de vendas.
DELETE FROM stock_salgadas
 WHERE nome IN ('A Que Todo Mundo Ama', 'A Irresistível', 'A Diferentona');
