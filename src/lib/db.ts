import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';
import { Pool, QueryResult } from 'pg';
import path from 'path';

let sqliteDb: Database | null = null;
let sqliteDbPromise: Promise<Database> | null = null;
let pgPool: Pool | null = null;

// Determine if we are running in Postgres mode
const isPostgres = () => {
  return process.env.DB_TYPE === 'postgres' || !!process.env.DATABASE_URL?.startsWith('postgres');
};

export async function getDb() {
  if (isPostgres()) {
    if (!pgPool) {
      pgPool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
      });
      await initPostgresSchema(pgPool);
    }
    return { type: 'postgres', client: pgPool };
  } else {
    if (!sqliteDbPromise) {
      sqliteDbPromise = (async () => {
        const dbPath = process.env.SQLITE_DB_PATH || path.join(process.cwd(), 'electro-mart.db');
        const db = await open({
          filename: dbPath,
          driver: sqlite3.Database,
        });
        await db.run('PRAGMA foreign_keys = ON;');
        await initSqliteSchema(db);
        sqliteDb = db;
        return db;
      })();
    }
    const db = await sqliteDbPromise;
    return { type: 'sqlite', client: db };
  }
}

// Unified query execution helper
export async function executeQuery<T = any>(sql: string, params: any[] = []): Promise<T[]> {
  const db = await getDb();
  
  if (db.type === 'postgres') {
    // In PostgreSQL, placeholders are $1, $2... which is standard.
    // If the SQL is written using $1, $2, it works out of the box in PostgreSQL.
    const pool = db.client as Pool;
    const res: QueryResult = await pool.query(sql, params);
    return res.rows as T[];
  } else {
    // In SQLite, the sqlite3 driver supports $1, $2... natively.
    // Let's bind parameters using sqlite Db.all
    const client = db.client as Database;
    
    // SQLite uses $1, $2... natively but requires them as keys in an object, or we can convert them to ? and bind as array.
    // To make it robust and compatible with standard SQL, let's map $1, $2... to ? and pass the array,
    // because SQLite.all(sql, params) with ? works perfectly.
    let sqliteSql = sql;
    const matches = sql.match(/\$\d+/g);
    if (matches) {
      // Replace $1 with ?1, $2 with ?2 etc. to support duplicate/out-of-order placeholders
      const uniqueMatches = Array.from(new Set(matches)).sort((a, b) => {
        const numA = parseInt(a.slice(1));
        const numB = parseInt(b.slice(1));
        return numB - numA;
      });
      for (const match of uniqueMatches) {
        const index = match.slice(1);
        sqliteSql = sqliteSql.replaceAll(match, `?${index}`);
      }
    }
    
    const rows = await client.all(sqliteSql, params);
    return rows as T[];
  }
}

// Unified write/update query execution helper
export async function executeRun(sql: string, params: any[] = []): Promise<{ lastID?: number; changes?: number }> {
  const db = await getDb();
  
  if (db.type === 'postgres') {
    const pool = db.client as Pool;
    // Postgres returning id
    let pgSql = sql;
    if (sql.toLowerCase().includes('insert into') && !sql.toLowerCase().includes('returning')) {
      pgSql += ' RETURNING id';
    }
    const res = await pool.query(pgSql, params);
    const lastID = res.rows[0]?.id;
    return { lastID, changes: res.rowCount ?? 0 };
  } else {
    const client = db.client as Database;
    let sqliteSql = sql;
    const matches = sql.match(/\$\d+/g);
    if (matches) {
      const uniqueMatches = Array.from(new Set(matches)).sort((a, b) => {
        const numA = parseInt(a.slice(1));
        const numB = parseInt(b.slice(1));
        return numB - numA;
      });
      for (const match of uniqueMatches) {
        const index = match.slice(1);
        sqliteSql = sqliteSql.replaceAll(match, `?${index}`);
      }
    }
    const res = await client.run(sqliteSql, params);
    return { lastID: res.lastID, changes: res.changes };
  }
}

async function initSqliteSchema(db: Database) {
  // Suppliers Table
  await db.exec(`
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

  // Purchase Orders Table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS purchase_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      po_number TEXT UNIQUE NOT NULL,
      supplier_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      total REAL NOT NULL,
      status TEXT NOT NULL,
      notes TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE CASCADE
    );
  `);

  // Products Table
  await db.exec(`
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

  // Customers Table
  await db.exec(`
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

  // Invoices Table
  await db.exec(`
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
      gst_irn TEXT,
      einvoice_ref TEXT,
      eway_bill_no TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (customer_id) REFERENCES customers(id)
    );
  `);

  // Add invoices compliance columns try-catch alters for migration of existing db
  try {
    await db.exec("ALTER TABLE invoices ADD COLUMN gst_irn TEXT;");
  } catch (e) {}
  try {
    await db.exec("ALTER TABLE invoices ADD COLUMN einvoice_ref TEXT;");
  } catch (e) {}
  try {
    await db.exec("ALTER TABLE invoices ADD COLUMN eway_bill_no TEXT;");
  } catch (e) {}
  try {
    await db.exec("ALTER TABLE invoices ADD COLUMN down_payment REAL DEFAULT 0;");
  } catch (e) {}
  try {
    await db.exec("ALTER TABLE invoices ADD COLUMN emi_amount REAL DEFAULT 0;");
  } catch (e) {}
  try {
    await db.exec("ALTER TABLE invoices ADD COLUMN finance_company TEXT;");
  } catch (e) {}

  // Invoice Items Table
  await db.exec(`
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

  // Sales Returns Table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS sales_returns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      return_number TEXT UNIQUE NOT NULL,
      invoice_id INTEGER NOT NULL,
      return_date TEXT NOT NULL,
      subtotal REAL NOT NULL,
      gst_amount REAL NOT NULL,
      total REAL NOT NULL,
      notes TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
    );
  `);

  // Sales Return Items Table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS sales_return_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sales_return_id INTEGER NOT NULL,
      product_id INTEGER,
      name TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      price REAL NOT NULL,
      gst_percentage REAL NOT NULL,
      gst_amount REAL NOT NULL,
      total REAL NOT NULL,
      FOREIGN KEY (sales_return_id) REFERENCES sales_returns(id) ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL
    );
  `);

  // Purchase Returns Table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS purchase_returns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      return_number TEXT UNIQUE NOT NULL,
      supplier_id INTEGER NOT NULL,
      return_date TEXT NOT NULL,
      subtotal REAL NOT NULL,
      gst_amount REAL NOT NULL,
      total REAL NOT NULL,
      notes TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (supplier_id) REFERENCES suppliers(id) ON DELETE CASCADE
    );
  `);

  // Purchase Return Items Table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS purchase_return_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      purchase_return_id INTEGER NOT NULL,
      product_id INTEGER,
      name TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      price REAL NOT NULL,
      gst_percentage REAL NOT NULL,
      gst_amount REAL NOT NULL,
      total REAL NOT NULL,
      FOREIGN KEY (purchase_return_id) REFERENCES purchase_returns(id) ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL
    );
  `);

  // Stock Transactions Table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS stock_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      transaction_type TEXT NOT NULL, -- 'Stock In', 'Stock Out', 'Adjustment', 'Damaged', 'Return'
      quantity INTEGER NOT NULL,
      reference_id TEXT, -- Invoice number or other reference
      notes TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (product_id) REFERENCES products(id)
    );
  `);

  // Business Profile Table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS business_profile (
      id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      name TEXT NOT NULL,
      address TEXT,
      phone TEXT,
      gstin TEXT,
      email TEXT,
      state TEXT,
      logo_base64 TEXT,
      bank_details TEXT,
      upi_id TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Seed default business profile if not exists
  const profile = await db.all("SELECT * FROM business_profile WHERE id = 1");
  if (profile.length === 0) {
    await db.run(`
      INSERT OR IGNORE INTO business_profile (id, name, address, phone, gstin, email, state)
      VALUES (1, 'Saral', 'N/A Santi Nagar main Road , 2n0 Dabgram Siliguri', '9046726365', '19ACRPD0341C1Z0', 'joydeep.dey1971@gmail.com', '19-West Bengal')
    `);
  }

  // Customer Payments Table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS customer_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      payment_date TEXT NOT NULL,
      payment_mode TEXT NOT NULL,
      reference TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
    );
  `);

  // Users Table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT DEFAULT 'Staff', -- 'Admin', 'Staff'
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Finance Partners Table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS finance_partners (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Seed default finance partners if not exists
  const fpCount = await db.all("SELECT * FROM finance_partners");
  if (fpCount.length === 0) {
    const defaultPartners = [
      'Bajaj Finance',
      'HDB Finance',
      'Home Credit',
      'TVS Credit',
      'IDFC First Bank'
    ];
    for (const partner of defaultPartners) {
      await db.run("INSERT OR IGNORE INTO finance_partners (name) VALUES (?)", [partner]);
    }
  }

  // Finance Cases Table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS finance_cases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_number TEXT NOT NULL UNIQUE,
      customer_name TEXT NOT NULL,
      product_details TEXT,
      total_amount REAL NOT NULL,
      down_payment REAL NOT NULL DEFAULT 0,
      financed_amount REAL NOT NULL DEFAULT 0,
      emi_amount REAL NOT NULL DEFAULT 0,
      finance_company TEXT NOT NULL,
      expected_payout REAL NOT NULL DEFAULT 0,
      received_payout REAL NOT NULL DEFAULT 0,
      pending_payout REAL NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Finance Payout History Table
  await db.exec(`
    CREATE TABLE IF NOT EXISTS finance_payout_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      case_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      received_date TEXT NOT NULL,
      reference TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (case_id) REFERENCES finance_cases(id) ON DELETE CASCADE
    );
  `);

  // Indexes
  await db.exec(`
    CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku);
    CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode);
    CREATE INDEX IF NOT EXISTS idx_products_name ON products(name);
    CREATE INDEX IF NOT EXISTS idx_invoices_num ON invoices(invoice_number);
    CREATE INDEX IF NOT EXISTS idx_customers_mobile ON customers(mobile);
  `);
  
  // Seed initial Admin user if not exists (username: admin, password: password - for local use)
  const users = await db.all("SELECT * FROM users WHERE username = 'admin'");
  if (users.length === 0) {
    await db.run("INSERT INTO users (username, password_hash, role) VALUES ('admin', '5e883f52468a65e1139930114a7f107f338b341b712aec87b282f85203d2d519', 'Admin')");
  }
}

async function initPostgresSchema(pool: Pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Suppliers Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS suppliers (
        id SERIAL PRIMARY KEY,
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

    // Purchase Orders Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS purchase_orders (
        id SERIAL PRIMARY KEY,
        po_number TEXT UNIQUE NOT NULL,
        supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
        date TEXT NOT NULL,
        total REAL NOT NULL,
        status TEXT NOT NULL,
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Products Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS products (
        id SERIAL PRIMARY KEY,
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
        supplier_id INTEGER REFERENCES suppliers(id),
        image_url TEXT,
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Customers Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS customers (
        id SERIAL PRIMARY KEY,
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

    // Invoices Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS invoices (
        id SERIAL PRIMARY KEY,
        invoice_number TEXT UNIQUE NOT NULL,
        customer_id INTEGER REFERENCES customers(id),
        date TEXT NOT NULL,
        subtotal REAL NOT NULL,
        gst_amount REAL NOT NULL,
        discount REAL DEFAULT 0,
        total REAL NOT NULL,
        payment_mode TEXT DEFAULT 'Cash',
        status TEXT DEFAULT 'unpaid',
        type TEXT DEFAULT 'Tax Invoice',
        notes TEXT,
        gst_irn TEXT,
        einvoice_ref TEXT,
        eway_bill_no TEXT,
        down_payment REAL DEFAULT 0,
        emi_amount REAL DEFAULT 0,
        finance_company TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Invoice Items Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS invoice_items (
        id SERIAL PRIMARY KEY,
        invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
        product_id INTEGER REFERENCES products(id),
        name TEXT NOT NULL,
        quantity INTEGER NOT NULL,
        price REAL NOT NULL,
        gst_percentage REAL NOT NULL,
        gst_amount REAL NOT NULL,
        discount REAL DEFAULT 0,
        total REAL NOT NULL
      );
    `);

    // Sales Returns Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS sales_returns (
        id SERIAL PRIMARY KEY,
        return_number TEXT UNIQUE NOT NULL,
        invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
        return_date TEXT NOT NULL,
        subtotal REAL NOT NULL,
        gst_amount REAL NOT NULL,
        total REAL NOT NULL,
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Sales Return Items Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS sales_return_items (
        id SERIAL PRIMARY KEY,
        sales_return_id INTEGER NOT NULL REFERENCES sales_returns(id) ON DELETE CASCADE,
        product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
        name TEXT NOT NULL,
        quantity INTEGER NOT NULL,
        price REAL NOT NULL,
        gst_percentage REAL NOT NULL,
        gst_amount REAL NOT NULL,
        total REAL NOT NULL
      );
    `);

    // Purchase Returns Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS purchase_returns (
        id SERIAL PRIMARY KEY,
        return_number TEXT UNIQUE NOT NULL,
        supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
        return_date TEXT NOT NULL,
        subtotal REAL NOT NULL,
        gst_amount REAL NOT NULL,
        total REAL NOT NULL,
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Purchase Return Items Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS purchase_return_items (
        id SERIAL PRIMARY KEY,
        purchase_return_id INTEGER NOT NULL REFERENCES purchase_returns(id) ON DELETE CASCADE,
        product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
        name TEXT NOT NULL,
        quantity INTEGER NOT NULL,
        price REAL NOT NULL,
        gst_percentage REAL NOT NULL,
        gst_amount REAL NOT NULL,
        total REAL NOT NULL
      );
    `);

    // Stock Transactions Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS stock_transactions (
        id SERIAL PRIMARY KEY,
        product_id INTEGER NOT NULL REFERENCES products(id),
        transaction_type TEXT NOT NULL,
        quantity INTEGER NOT NULL,
        reference_id TEXT,
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Business Profile Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS business_profile (
        id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
        name TEXT NOT NULL,
        address TEXT,
        phone TEXT,
        gstin TEXT,
        email TEXT,
        state TEXT,
        logo_base64 TEXT,
        bank_details TEXT,
        upi_id TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Seed default business profile if not exists
    await client.query(`
      INSERT INTO business_profile (id, name, address, phone, gstin, email, state)
      VALUES (1, 'Saral', 'N/A Santi Nagar main Road , 2n0 Dabgram Siliguri', '9046726365', '19ACRPD0341C1Z0', 'joydeep.dey1971@gmail.com', '19-West Bengal')
      ON CONFLICT (id) DO NOTHING;
    `);

    // Customer Payments Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS customer_payments (
        id SERIAL PRIMARY KEY,
        customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
        amount REAL NOT NULL,
        payment_date TEXT NOT NULL,
        payment_mode TEXT NOT NULL,
        reference TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Users Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        role TEXT DEFAULT 'Staff',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Seed default admin user
    await client.query(`
      INSERT INTO users (username, password_hash, role)
      VALUES ('admin', '5e883f52468a65e1139930114a7f107f338b341b712aec87b282f85203d2d519', 'Admin')
      ON CONFLICT (username) DO NOTHING;
    `);

    // Finance Partners Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS finance_partners (
        id SERIAL PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Seed default finance partners
    const partners = ['Bajaj Finance', 'HDB Finance', 'Home Credit', 'TVS Credit', 'IDFC First Bank'];
    for (const partner of partners) {
      await client.query("INSERT INTO finance_partners (name) VALUES ($1) ON CONFLICT (name) DO NOTHING;", [partner]);
    }

    // Finance Cases Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS finance_cases (
        id SERIAL PRIMARY KEY,
        invoice_number TEXT NOT NULL UNIQUE,
        customer_name TEXT NOT NULL,
        product_details TEXT,
        total_amount REAL NOT NULL,
        down_payment REAL NOT NULL DEFAULT 0,
        financed_amount REAL NOT NULL DEFAULT 0,
        emi_amount REAL NOT NULL DEFAULT 0,
        finance_company TEXT NOT NULL,
        expected_payout REAL NOT NULL DEFAULT 0,
        received_payout REAL NOT NULL DEFAULT 0,
        pending_payout REAL NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Finance Payout History Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS finance_payout_history (
        id SERIAL PRIMARY KEY,
        case_id INTEGER NOT NULL REFERENCES finance_cases(id) ON DELETE CASCADE,
        amount REAL NOT NULL,
        received_date TEXT NOT NULL,
        reference TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Indexes
    await client.query("CREATE INDEX IF NOT EXISTS idx_products_sku ON products(sku);");
    await client.query("CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode);");
    await client.query("CREATE INDEX IF NOT EXISTS idx_products_name ON products(name);");
    await client.query("CREATE INDEX IF NOT EXISTS idx_invoices_num ON invoices(invoice_number);");
    await client.query("CREATE INDEX IF NOT EXISTS idx_customers_mobile ON customers(mobile);");

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('PostgreSQL Schema Initialization Error:', e);
    throw e;
  } finally {
    client.release();
  }
}
