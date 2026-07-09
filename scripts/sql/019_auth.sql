-- Auth propia sobre Postgres (reemplazo de Firebase Auth). Guardamos las
-- credenciales en mdtask_usuarios: los hashes scrypt EXPORTADOS de Firebase
-- (password_algo='firebase-scrypt', con su password_salt) y, para usuarios
-- nuevos o que cambien su contraseña, un hash bcrypt (password_algo='bcrypt',
-- sin salt aparte). El login (api/login.js) verifica según password_algo y
-- emite un JWT propio. Prefijo mdtask_ (Postgres compartido).
alter table mdtask_usuarios add column if not exists password_hash text;
alter table mdtask_usuarios add column if not exists password_salt text;
alter table mdtask_usuarios add column if not exists password_algo text;  -- 'firebase-scrypt' | 'bcrypt'
