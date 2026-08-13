-- ============================================================
--  InfraWatch — Supabase PostgreSQL Schema
--  Run this in: Supabase Dashboard → SQL Editor → New query
-- ============================================================

-- ── USERS ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          VARCHAR(100)  NOT NULL,
  email         VARCHAR(150)  NOT NULL UNIQUE,
  password_hash TEXT          NOT NULL,
  role          VARCHAR(20)   NOT NULL DEFAULT 'user',
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ── REPORTS ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reports (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID          REFERENCES users(id) ON DELETE SET NULL,
  name            VARCHAR(100),
  phone           VARCHAR(30),
  category        VARCHAR(50)   NOT NULL,
  problem_type    VARCHAR(80)   NOT NULL,
  description     TEXT          NOT NULL,
  image_url       TEXT,
  location_name   VARCHAR(200)  NOT NULL,
  latitude        DECIMAL(9,6)  NOT NULL,
  longitude       DECIMAL(9,6)  NOT NULL,
  severity        VARCHAR(20)   NOT NULL DEFAULT 'medium',
  nlp_confidence  DECIMAL(5,4),
  ml_label        VARCHAR(80),
  status          VARCHAR(30)   NOT NULL DEFAULT 'pending',
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reports_location ON reports (latitude, longitude);
CREATE INDEX IF NOT EXISTS idx_reports_category ON reports (category);
CREATE INDEX IF NOT EXISTS idx_reports_severity  ON reports (severity);
CREATE INDEX IF NOT EXISTS idx_reports_status    ON reports (status);

-- ── FUEL STATIONS ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fuel_stations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            VARCHAR(150)  NOT NULL,
  area            VARCHAR(150)  NOT NULL,
  latitude        DECIMAL(9,6)  NOT NULL,
  longitude       DECIMAL(9,6)  NOT NULL,
  status          VARCHAR(20)   NOT NULL DEFAULT 'available',
  diesel_price    DECIMAL(6,3),
  gasoline_price  DECIMAL(6,3),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ── TRANSPORT ROUTES ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS transport_routes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  route_number    INT           NOT NULL,
  origin          VARCHAR(100)  NOT NULL,
  destination     VARCHAR(100)  NOT NULL,
  stops           INT,
  duration        VARCHAR(30),
  frequency       VARCHAR(50),
  price_range     VARCHAR(30),
  distance_km     INT,
  status          VARCHAR(20)   NOT NULL DEFAULT 'normal'
);

-- ── OUTAGE DATA (per district, per month) ────────────────────
CREATE TABLE IF NOT EXISTS outage_data (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  district    VARCHAR(100) NOT NULL,
  month_name  VARCHAR(20)  NOT NULL,
  month_num   INT          NOT NULL,
  year        INT          NOT NULL DEFAULT 2025,
  avg_hours   DECIMAL(4,1) NOT NULL,
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ── NOTIFICATIONS ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        VARCHAR(50)  NOT NULL,
  message     TEXT         NOT NULL,
  read        BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ════════════════════════════════════════════════════════════
--  SEED DATA
-- ════════════════════════════════════════════════════════════

-- Fuel stations (real Lebanon locations with coordinates)
INSERT INTO fuel_stations (name, area, latitude, longitude, status, diesel_price, gasoline_price) VALUES
  ('Total Beirut Central',  'Hamra, Beirut',        33.8938, 35.5018, 'available', 1.85, 1.92),
  ('Shell Jounieh',         'Kaslik, Jounieh',      33.9806, 35.6178, 'available', 1.83, 1.90),
  ('Medco Tripoli',         'Al Mina, Tripoli',     34.4369, 35.8497, 'limited',   1.80, 1.88),
  ('IPT Saida',             'Old Saida Road',       33.5570, 35.3725, 'available', 1.84, 1.91),
  ('Gulf Bekaa',            'Zahle Main Road',      33.8469, 35.9019, 'available', 1.82, 1.89),
  ('Coral Nabatieh',        'South Highway',        33.3772, 35.4839, 'limited',   1.81, 1.87),
  ('Total Baabda',          'Baabda, Mount Lebanon',33.8345, 35.5432, 'available', 1.85, 1.92),
  ('Caltex Dora',           'Dora, Beirut',         33.9014, 35.5731, 'available', 1.83, 1.90),
  ('Sonangol Batroun',      'Batroun Coast Road',   34.2556, 35.6589, 'limited',   1.82, 1.89)
ON CONFLICT DO NOTHING;

-- Transport routes (all major Lebanon intercity routes)
INSERT INTO transport_routes (route_number, origin, destination, stops, duration, frequency, price_range, distance_km, status) VALUES
  (1,  'Beirut (Cola)',   'Tripoli',        20, '1h 30min', 'Every 30 min',  '$3–4',      85, 'normal'),
  (2,  'Beirut (Dora)',   'Jounieh',         8, '30 min',   'Every 15 min',  '$1.50–2',   20, 'normal'),
  (3,  'Beirut (Cola)',   'Saida',          12, '50 min',   'Every 20 min',  '$2–3',      45, 'normal'),
  (4,  'Tripoli',         'Batroun',         6, '35 min',   'Every 40 min',  '$2',        22, 'normal'),
  (5,  'Saida',           'Tyre',           10, '45 min',   'Every 30 min',  '$2.50–3',   40, 'normal'),
  (6,  'Beirut (Dora)',   'Zahle',          15, '1h 10min', 'Every 45 min',  '$3–4',      55, 'normal'),
  (7,  'Beirut (Cola)',   'Nabatieh',       14, '1h 10min', 'Every 40 min',  '$3–4',      60, 'normal'),
  (8,  'Tripoli',         'Zgharta',         5, '20 min',   'Every 20 min',  '$1–1.50',   12, 'normal'),
  (9,  'Beirut (Dora)',   'Byblos (Jbeil)', 10, '45 min',   'Every 30 min',  '$2.50–3',   37, 'normal'),
  (10, 'Zahle',           'Baalbek',         8, '40 min',   'Every 45 min',  '$2–2.50',   35, 'normal')
ON CONFLICT DO NOTHING;

-- Outage data — per district, full year 2025 (based on published EDL reports)
INSERT INTO outage_data (district, month_name, month_num, year, avg_hours) VALUES
  -- Beirut
  ('Beirut',         'Jan', 1, 2025, 18.0), ('Beirut',         'Feb', 2, 2025, 16.5),
  ('Beirut',         'Mar', 3, 2025, 14.0), ('Beirut',         'Apr', 4, 2025, 15.0),
  ('Beirut',         'May', 5, 2025, 17.5), ('Beirut',         'Jun', 6, 2025, 20.0),
  ('Beirut',         'Jul', 7, 2025, 22.0), ('Beirut',         'Aug', 8, 2025, 21.5),
  ('Beirut',         'Sep', 9, 2025, 19.0), ('Beirut',         'Oct',10, 2025, 16.0),
  ('Beirut',         'Nov',11, 2025, 14.5), ('Beirut',         'Dec',12, 2025, 17.0),
  -- Mount Lebanon
  ('Mount Lebanon',  'Jan', 1, 2025, 20.0), ('Mount Lebanon',  'Feb', 2, 2025, 18.0),
  ('Mount Lebanon',  'Mar', 3, 2025, 15.5), ('Mount Lebanon',  'Apr', 4, 2025, 16.5),
  ('Mount Lebanon',  'May', 5, 2025, 19.0), ('Mount Lebanon',  'Jun', 6, 2025, 21.5),
  ('Mount Lebanon',  'Jul', 7, 2025, 23.0), ('Mount Lebanon',  'Aug', 8, 2025, 22.0),
  ('Mount Lebanon',  'Sep', 9, 2025, 20.0), ('Mount Lebanon',  'Oct',10, 2025, 17.5),
  ('Mount Lebanon',  'Nov',11, 2025, 15.0), ('Mount Lebanon',  'Dec',12, 2025, 18.5),
  -- North Lebanon
  ('North Lebanon',  'Jan', 1, 2025, 21.0), ('North Lebanon',  'Feb', 2, 2025, 19.5),
  ('North Lebanon',  'Mar', 3, 2025, 17.0), ('North Lebanon',  'Apr', 4, 2025, 18.0),
  ('North Lebanon',  'May', 5, 2025, 20.5), ('North Lebanon',  'Jun', 6, 2025, 22.5),
  ('North Lebanon',  'Jul', 7, 2025, 23.5), ('North Lebanon',  'Aug', 8, 2025, 23.0),
  ('North Lebanon',  'Sep', 9, 2025, 21.0), ('North Lebanon',  'Oct',10, 2025, 18.5),
  ('North Lebanon',  'Nov',11, 2025, 16.0), ('North Lebanon',  'Dec',12, 2025, 19.5),
  -- South Lebanon
  ('South Lebanon',  'Jan', 1, 2025, 19.5), ('South Lebanon',  'Feb', 2, 2025, 18.0),
  ('South Lebanon',  'Mar', 3, 2025, 16.0), ('South Lebanon',  'Apr', 4, 2025, 17.0),
  ('South Lebanon',  'May', 5, 2025, 20.0), ('South Lebanon',  'Jun', 6, 2025, 22.0),
  ('South Lebanon',  'Jul', 7, 2025, 23.0), ('South Lebanon',  'Aug', 8, 2025, 22.5),
  ('South Lebanon',  'Sep', 9, 2025, 20.5), ('South Lebanon',  'Oct',10, 2025, 17.0),
  ('South Lebanon',  'Nov',11, 2025, 15.5), ('South Lebanon',  'Dec',12, 2025, 18.0),
  -- Bekaa
  ('Bekaa',          'Jan', 1, 2025, 22.5), ('Bekaa',          'Feb', 2, 2025, 21.0),
  ('Bekaa',          'Mar', 3, 2025, 18.5), ('Bekaa',          'Apr', 4, 2025, 19.5),
  ('Bekaa',          'May', 5, 2025, 21.5), ('Bekaa',          'Jun', 6, 2025, 23.0),
  ('Bekaa',          'Jul', 7, 2025, 23.8), ('Bekaa',          'Aug', 8, 2025, 23.5),
  ('Bekaa',          'Sep', 9, 2025, 22.0), ('Bekaa',          'Oct',10, 2025, 19.0),
  ('Bekaa',          'Nov',11, 2025, 17.0), ('Bekaa',          'Dec',12, 2025, 20.5)
ON CONFLICT DO NOTHING;

-- Demo reports so the project shows data immediately
INSERT INTO reports (name, phone, category, problem_type, description, location_name, latitude, longitude, severity, status) VALUES
  ('Ahmad Khalil',   '+961 70 123 456', 'electricity',    'Power Outage',        'el kahraba ma rje3et men mbere7, kel el hay2 bel dark',       'Hamra, Beirut',      33.8938, 35.5018, 'high',     'pending'),
  ('Sara Nassar',    '+961 71 234 567', 'roads',          'Pothole',             'fi hole kbir bel tari2 3end el jame3, khatar 3al sayarat',     'Ashrafieh, Beirut',  33.8869, 35.5131, 'medium',   'reviewed'),
  ('Omar Fayyad',    '+961 76 345 678', 'fuel',           'Long Queues',         'tabour tawil jiddan 3end محطة total, aktar men sa3a ntizaar',  'Jounieh Highway',    33.9806, 35.6178, 'medium',   'pending'),
  ('Maya Haddad',    '+961 78 456 789', 'transportation', 'Service Delay',       'Bus route 2 ma jet men sa3et, fi mawkef bel dora',             'Dora, Beirut',       33.9014, 35.5731, 'low',      'pending'),
  ('Karim Younes',   '+961 81 567 890', 'roads',          'Flooding',            'el tari2 ghar2an bel ma, ma fi sarfiye, impossible tmure',      'Tripoli - Mina',     34.4369, 35.8497, 'critical', 'pending'),
  ('Lara Gebran',    '+961 70 678 901', 'electricity',    'Damaged Power Line',  'Silk ma3 el kahraba wakel, khatar yowke3 3al nas',             'Baabda, Mount Lebanon', 33.8345, 35.5432, 'critical','reviewed'),
  ('Nour Abi Nader', '+961 71 789 012', 'roads',          'Cracks',              'Street cracks spreading near old building, dangerous zone',    'Gemmayze, Beirut',   33.8912, 35.5231, 'high',     'pending'),
  ('Rami Khoury',    '+961 76 890 123', 'fuel',           'Station Closed',      'محطة الكورال مسكرة من 3 ايام, ما في معلومات متى بترجع',      'Nabatieh South',     33.3772, 35.4839, 'medium',   'pending')
ON CONFLICT DO NOTHING;
