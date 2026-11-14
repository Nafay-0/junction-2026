-- Lets the app's user create and drop throwaway databases named dock_test_*, so the live tests
-- (web/src/server/mariadb/mariadb.live.test.ts) never touch dock_audit. Runs once, when the volume is created.
GRANT ALL PRIVILEGES ON `dock\_test\_%`.* TO 'dock'@'%';
FLUSH PRIVILEGES;
