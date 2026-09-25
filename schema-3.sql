-- Esfiha da Casa — notificações no telemóvel.
CREATE TABLE IF NOT EXISTS subscricoes (
  endpoint   TEXT PRIMARY KEY,
  p256dh     TEXT,
  auth       TEXT,
  criado_em  TEXT NOT NULL,
  ultimo_erro TEXT
);
