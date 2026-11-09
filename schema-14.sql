
-- Cartao de fidelidade: codigos de percentagem ligados a um telefone.
-- NAO precisa de ser corrido a mao: o servidor acrescenta estas colunas
-- sozinho na primeira vez que sao precisas. Fica aqui como registo.
ALTER TABLE codigos_promo ADD COLUMN desconto_pct INTEGER NOT NULL DEFAULT 0;
ALTER TABLE codigos_promo ADD COLUMN telefone TEXT;
ALTER TABLE codigos_promo ADD COLUMN tipo TEXT;
ALTER TABLE codigos_promo ADD COLUMN marco INTEGER;
ALTER TABLE codigos_promo ADD COLUMN pedido_origem_id INTEGER;
