/**
 * Global Jest setup — pakai SQLite in-memory untuk testing.
 * Set sebelum any module import config.
 */
process.env.DATABASE_PATH = ":memory:";
process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "silent";
