'use client';

import React, { useState, useEffect } from 'react';
import { dbQuery, dbRun } from '@/lib/api';

export default function MigrationAssistant({ onMigrationComplete }: { onMigrationComplete: () => void }) {
  const [hasData, setHasData] = useState(false);
  const [migrating, setMigrating] = useState(false);
  const [statusText, setStatusText] = useState('');

  useEffect(() => {
    // Check if localStorage has old ElectroMart data
    if (typeof window !== 'undefined') {
      const prods = localStorage.getItem('em_products');
      const custs = localStorage.getItem('em_customers');
      const invs = localStorage.getItem('em_invoices');

      if (prods || custs || invs) {
        // Double check if database already has data to avoid showing this if database is already populated
        dbQuery('SELECT COUNT(*) as count FROM products').then((res) => {
          const count = res[0]?.count || 0;
          if (count === 0) {
            setHasData(true);
          }
        }).catch((err) => console.error('Migration check failed:', err));
      }
    }
  }, []);

  const handleMigration = async () => {
    if (!confirm('Are you sure you want to migrate your local data to the database? This will populate the SQL database with your existing records.')) {
      return;
    }

    setMigrating(true);
    setStatusText('Starting migration...');

    try {
      // 1. Migrate Suppliers (if any) or create default Supplier
      setStatusText('Setting up default supplier...');
      const defaultSupplierRes = await dbRun(
        `INSERT INTO suppliers (name, mobile, email, address) VALUES ($1, $2, $3, $4)`,
        ['General Supplier', '0000000000', 'supplier@jiyasarcade.in', 'Bhubaneswar']
      );
      const supplierId = defaultSupplierRes.lastID || 1;

      // 2. Migrate Customers
      setStatusText('Migrating customers...');
      const custStr = localStorage.getItem('em_customers');
      const oldCustomers = custStr ? JSON.parse(custStr) : [];
      const customerIdMap = new Map<number, number>(); // maps old ID to new DB ID

      for (const c of oldCustomers) {
        const res = await dbRun(
          `INSERT INTO customers (name, mobile, email, address, gstin, state) VALUES ($1, $2, $3, $4, $5, $6)`,
          [c.name, c.phone || '', c.email || '', c.address || '', c.gstin || '', 'Odisha']
        );
        if (res.lastID) {
          customerIdMap.set(c.id, res.lastID);
        }
      }

      // 3. Migrate Products
      setStatusText('Migrating products...');
      const prodStr = localStorage.getItem('em_products');
      const oldProducts = prodStr ? JSON.parse(prodStr) : [];
      const productIdMap = new Map<number, number>(); // maps old ID to new DB ID

      for (const p of oldProducts) {
        // HSN maps
        const HSN_MAP: Record<number, string> = { 28: '85287300', 18: '84181000', 12: '85094010', 5: '84151010' };
        const hsn = HSN_MAP[p.gst] || '85094010';
        
        const res = await dbRun(
          `INSERT INTO products (name, sku, barcode, category, brand, unit, hsn_code, gst_percentage, purchase_price, selling_price, mrp, opening_stock, current_stock, reserved_stock, available_stock, supplier_id) 
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
          [
            p.name, 
            `SKU-${p.id}`, 
            `BC-${100000 + p.id}`, 
            p.category || 'TVs', 
            p.brand || 'General', 
            'Nos', 
            hsn, 
            p.gst || 18, 
            p.price * 0.7, // Estimate purchase price as 70% of sell price for migration
            p.price, 
            p.price, 
            p.stock || 0, 
            p.stock || 0, 
            0, 
            p.stock || 0, 
            supplierId
          ]
        );
        if (res.lastID) {
          productIdMap.set(p.id, res.lastID);
        }
      }

      // 4. Migrate Invoices
      setStatusText('Migrating invoices...');
      const invStr = localStorage.getItem('em_invoices');
      const oldInvoices = invStr ? JSON.parse(invStr) : [];

      for (const inv of oldInvoices) {
        const newCustomerId = customerIdMap.get(inv.customer_id) || null;
        
        const invRes = await dbRun(
          `INSERT INTO invoices (invoice_number, customer_id, date, subtotal, gst_amount, total, payment_mode, status, type, notes) 
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            inv.invoice_number,
            newCustomerId,
            inv.date,
            inv.subtotal,
            inv.gst_amount,
            inv.total,
            'Cash',
            inv.status || 'unpaid',
            'Tax Invoice',
            inv.notes || ''
          ]
        );

        const newInvoiceId = invRes.lastID;
        if (newInvoiceId && inv.items) {
          for (const item of inv.items) {
            const newProductId = item.product_id ? (productIdMap.get(item.product_id) || null) : null;
            
            await dbRun(
              `INSERT INTO invoice_items (invoice_id, product_id, name, quantity, price, gst_percentage, gst_amount, total) 
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
              [
                newInvoiceId,
                newProductId,
                item.name,
                item.quantity || 1,
                item.price || 0,
                item.gst || 18,
                item.gst_amount || 0,
                item.total || 0
              ]
            );
          }
        }
      }

      setStatusText('Migration complete! Cleaning up local storage cache...');
      
      // Clear localStorage so it doesn't prompt again
      localStorage.removeItem('em_products');
      localStorage.removeItem('em_customers');
      localStorage.removeItem('em_invoices');

      setHasData(false);
      alert('🎉 Migration of your data was successful!');
      onMigrationComplete();
    } catch (err: any) {
      console.error('Migration failed:', err);
      setStatusText(`Error during migration: ${err.message || err}`);
      alert(`Migration error: ${err.message || err}`);
    } finally {
      setMigrating(false);
    }
  };

  if (!hasData) return null;

  return (
    <div style={{
      background: 'linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%)',
      border: '1px solid #bbf7d0',
      borderRadius: '12px',
      padding: '16px 20px',
      marginBottom: '24px',
      display: 'flex',
      flexDirection: 'column',
      gap: '12px',
      boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05)'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <span style={{ fontSize: '20px' }}>📦</span>
        <div>
          <h4 style={{ fontWeight: 700, color: '#166534', fontSize: '15px' }}>Migration Assistant</h4>
          <p style={{ color: '#15803d', fontSize: '13px', marginTop: '2px' }}>
            We detected legacy browser records (products, customers, invoices) from your previous application version.
          </p>
        </div>
      </div>
      
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap' }}>
        <button 
          onClick={handleMigration} 
          disabled={migrating}
          style={{
            background: 'var(--brand)',
            color: '#fff',
            border: 'none',
            padding: '8px 16px',
            borderRadius: '6px',
            fontWeight: 600,
            fontSize: '13px',
            cursor: migrating ? 'not-allowed' : 'pointer',
            transition: 'background 0.2s',
            opacity: migrating ? 0.7 : 1
          }}
        >
          {migrating ? 'Migrating data...' : 'Migrate Data Now'}
        </button>
        {statusText && <span style={{ fontSize: '12px', color: '#166534', fontWeight: 500 }}>{statusText}</span>}
      </div>
    </div>
  );
}
