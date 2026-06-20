const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');

let mainWindow;
let database;

// Initialize SQLite database inside Electron main process
async function initDatabase() {
  const userDataPath = app.getPath('userData');
  const dbPath = path.join(userDataPath, 'electro-mart.db');
  console.log('Database Path:', dbPath);

  database = await open({
    filename: dbPath,
    driver: sqlite3.Database
  });

  await database.run('PRAGMA foreign_keys = ON;');

  // Schema Creation
  await database.exec(`
    CREATE TABLE IF NOT EXISTS suppliers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      mobile TEXT,
      email TEXT,
      address TEXT,
      gstin TEXT,
      state TEXT,
      outstanding_balance REAL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await database.exec(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      sku TEXT UNIQUE,
      barcode TEXT UNIQUE,
      category TEXT,
      brand TEXT,
      unit TEXT,
      hsn_code TEXT,
      gst_percentage REAL DEFAULT 0,
      purchase_price REAL DEFAULT 0,
      selling_price REAL DEFAULT 0,
      mrp REAL DEFAULT 0,
      opening_stock INTEGER DEFAULT 0,
      current_stock INTEGER DEFAULT 0,
      reserved_stock INTEGER DEFAULT 0,
      available_stock INTEGER DEFAULT 0,
      reorder_level INTEGER DEFAULT 0,
      supplier_id INTEGER,
      image_url TEXT,
      notes TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (supplier_id) REFERENCES suppliers(id)
    );
  `);

  await database.exec(`
    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      mobile TEXT,
      email TEXT,
      address TEXT,
      gstin TEXT,
      state TEXT,
      credit_limit REAL DEFAULT 0,
      outstanding_balance REAL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await database.exec(`
    CREATE TABLE IF NOT EXISTS invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_number TEXT UNIQUE NOT NULL,
      customer_id INTEGER,
      date TEXT NOT NULL,
      subtotal REAL NOT NULL,
      gst_amount REAL NOT NULL,
      discount REAL DEFAULT 0,
      total REAL NOT NULL,
      payment_mode TEXT DEFAULT 'Cash',
      status TEXT DEFAULT 'unpaid',
      type TEXT DEFAULT 'Tax Invoice',
      notes TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (customer_id) REFERENCES customers(id)
    );
  `);

  await database.exec(`
    CREATE TABLE IF NOT EXISTS invoice_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_id INTEGER NOT NULL,
      product_id INTEGER,
      name TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      price REAL NOT NULL,
      gst_percentage REAL NOT NULL,
      gst_amount REAL NOT NULL,
      discount REAL DEFAULT 0,
      total REAL NOT NULL,
      FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products(id)
    );
  `);

  await database.exec(`
    CREATE TABLE IF NOT EXISTS stock_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      transaction_type TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      reference_id TEXT,
      notes TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (product_id) REFERENCES products(id)
    );
  `);

  await database.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT DEFAULT 'Staff',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await database.exec(`
    CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku);
    CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode);
    CREATE INDEX IF NOT EXISTS idx_products_name ON products(name);
    CREATE INDEX IF NOT EXISTS idx_invoices_num ON invoices(invoice_number);
    CREATE INDEX IF NOT EXISTS idx_customers_mobile ON customers(mobile);
  `);

  // Default admin profile seed
  const adminExists = await database.get("SELECT id FROM users WHERE username = 'admin'");
  if (!adminExists) {
    await database.run("INSERT INTO users (username, password_hash, role) VALUES ('admin', '5e883f52468a65e1139930114a7f107f338b341b712aec87b282f85203d2d519', 'Admin')");
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  // Check if we are in development mode
  const isDev = process.env.NODE_ENV === 'development';

  if (isDev) {
    mainWindow.loadURL('http://localhost:3000');
    mainWindow.webContents.openDevTools();
  } else {
    // In production, Next.js static files reside in the compiled out folder
    const indexPath = path.join(__dirname, '../out/index.html');
    if (fs.existsSync(indexPath)) {
      mainWindow.loadFile(indexPath);
    } else {
      mainWindow.loadURL('http://localhost:3000'); // Fallback dev
    }
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// IPC Handlers mapping SQLite database operations
ipcMain.handle('db:query', async (event, sql, params = []) => {
  try {
    let querySql = sql;
    const matches = sql.match(/\$\d+/g);
    if (matches) {
      const uniqueMatches = Array.from(new Set(matches)).sort((a, b) => {
        const numA = parseInt(a.slice(1));
        const numB = parseInt(b.slice(1));
        return numB - numA;
      });
      for (const match of uniqueMatches) {
        querySql = querySql.replaceAll(match, '?');
      }
    }
    const rows = await database.all(querySql, params);
    return rows;
  } catch (err) {
    console.error('IPC db:query Error:', err, 'SQL:', sql);
    throw err;
  }
});

ipcMain.handle('db:run', async (event, sql, params = []) => {
  try {
    let runSql = sql;
    const matches = sql.match(/\$\d+/g);
    if (matches) {
      const uniqueMatches = Array.from(new Set(matches)).sort((a, b) => {
        const numA = parseInt(a.slice(1));
        const numB = parseInt(b.slice(1));
        return numB - numA;
      });
      for (const match of uniqueMatches) {
        runSql = runSql.replaceAll(match, '?');
      }
    }
    const result = await database.run(runSql, params);
    return { lastID: result.lastID, changes: result.changes };
  } catch (err) {
    console.error('IPC db:run Error:', err, 'SQL:', sql);
    throw err;
  }
});

app.on('ready', async () => {
  await initDatabase();
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});
