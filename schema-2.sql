-- Esfiha da Casa — segunda parte: acompanhamento, contacto e origem do tráfego.

ALTER TABLE pedidos ADD COLUMN token TEXT;        -- link público de acompanhamento
ALTER TABLE pedidos ADD COLUMN telefone TEXT;     -- para o botão de WhatsApp no painel
ALTER TABLE pedidos ADD COLUMN origem TEXT;       -- instagram, google, anúncio, direto…
ALTER TABLE pedidos ADD COLUMN campanha TEXT;     -- utm_campaign, quando existe

CREATE INDEX IF NOT EXISTS idx_pedidos_token ON pedidos (token);

-- Uma linha por visita à loja, para se saber quantos entram e quantos compram.
CREATE TABLE IF NOT EXISTS visitas (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  dia       TEXT NOT NULL,
  origem    TEXT,
  campanha  TEXT,
  pagina    TEXT,
  criado_em TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_visitas_dia ON visitas (dia, origem);
