'use client';

import React, { useState, useEffect } from 'react';
import { dbQuery, dbRun } from '@/lib/api';

interface UserRecord {
  id: number;
  username: string;
  role: string;
  created_at: string;
}

export default function SettingsView() {
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusMsg, setStatusMsg] = useState('');
  
  // Security form
  const [newUser, setNewUser] = useState({ username: '', password: '', role: 'Staff' });

  // Business profile settings state
  const [profile, setProfile] = useState({
    name: "Jiya's Arcade",
    address: 'N/A Santi Nagar main Road , 2n0 Dabgram Siliguri',
    phone: '9046726365',
    gstin: '19ACRPD0341C1Z0',
    email: 'joydeep.dey1971@gmail.com',
    state: '19-West Bengal',
    logo_base64: '',
    bank_details: '',
    upi_id: '',
  });

  useEffect(() => {
    loadUsers();
    loadProfile();
  }, []);

  const loadProfile = async () => {
    try {
      const res = await dbQuery('SELECT * FROM business_profile WHERE id = 1');
      if (res.length > 0) {
        setProfile({
          name: res[0].name || '',
          address: res[0].address || '',
          phone: res[0].phone || '',
          gstin: res[0].gstin || '',
          email: res[0].email || '',
          state: res[0].state || '',
          logo_base64: res[0].logo_base64 || '',
          bank_details: res[0].bank_details || '',
          upi_id: res[0].upi_id || '',
        });
      }
    } catch (err) {
      console.error('Failed to load business profile settings:', err);
    }
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const updateRes = await dbRun(`
        UPDATE business_profile SET
          name = $1, address = $2, phone = $3, gstin = $4, email = $5, state = $6,
          logo_base64 = $7, bank_details = $8, upi_id = $9
        WHERE id = 1
      `, [profile.name, profile.address, profile.phone, profile.gstin, profile.email, profile.state, profile.logo_base64, profile.bank_details, profile.upi_id]);
      
      if (!updateRes.changes) {
        await dbRun(`
          INSERT INTO business_profile (id, name, address, phone, gstin, email, state, logo_base64, bank_details, upi_id)
          VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8, $9)
        `, [profile.name, profile.address, profile.phone, profile.gstin, profile.email, profile.state, profile.logo_base64, profile.bank_details, profile.upi_id]);
      }
      
      alert('✅ Jiya\'s Arcade profile details updated successfully!');
    } catch (err: any) {
      alert(`Failed to save settings: ${err.message || err}`);
    }
  };

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setProfile(prev => ({ ...prev, logo_base64: reader.result as string }));
    };
    reader.readAsDataURL(file);
  };

  const loadUsers = async () => {
    setLoading(true);
    try {
      const res = await dbQuery('SELECT id, username, role, created_at FROM users');
      setUsers(res);
    } catch (err) {
      console.error('Failed to load user registry:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUser.username || !newUser.password) return alert('Username and Password are required.');

    try {
      const encoder = new TextEncoder();
      const data = encoder.encode(newUser.password);
      const hashBuffer = await crypto.subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const passwordHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

      await dbRun(
        'INSERT INTO users (username, password_hash, role) VALUES ($1, $2, $3)',
        [newUser.username.trim().toLowerCase(), passwordHash, newUser.role]
      );

      setNewUser({ username: '', password: '', role: 'Staff' });
      loadUsers();
      alert(`User "${newUser.username}" created successfully.`);
    } catch (err: any) {
      alert(`Failed to create user: ${err.message || err}`);
    }
  };

  const handleDeleteUser = async (id: number, name: string) => {
    if (name === 'admin') return alert('The default root administrator cannot be deleted.');
    if (!confirm(`Delete user account: "${name}"?`)) return;

    try {
      await dbRun('DELETE FROM users WHERE id = $1', [id]);
      loadUsers();
    } catch (err: any) {
      alert(`Delete failed: ${err.message || err}`);
    }
  };

  const handleBackup = async () => {
    setStatusMsg('Compiling database records...');
    try {
      const backupData = {
        meta: {
          app: 'ElectroMart',
          version: '1.0.0',
          timestamp: new Date().toISOString()
        },
        data: {
          suppliers: await dbQuery('SELECT * FROM suppliers'),
          products: await dbQuery('SELECT * FROM products'),
          customers: await dbQuery('SELECT * FROM customers'),
          invoices: await dbQuery('SELECT * FROM invoices'),
          invoice_items: await dbQuery('SELECT * FROM invoice_items'),
          stock_transactions: await dbQuery('SELECT * FROM stock_transactions'),
          users: await dbQuery('SELECT id, username, password_hash, role, created_at FROM users'),
          business_profile: await dbQuery('SELECT * FROM business_profile')
        }
      };

      setStatusMsg('Serializing backup file...');
      const jsonStr = JSON.stringify(backupData, null, 2);
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      
      const a = document.createElement('a');
      a.href = url;
      a.download = `jiyas-arcade-backup-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setStatusMsg('🎉 Backup file downloaded successfully.');
    } catch (err: any) {
      setStatusMsg(`Backup failed: ${err.message || err}`);
      alert(`Backup failed: ${err.message || err}`);
    }
  };

  const handleRestore = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const confirmRestore = confirm('🚨 CRITICAL WARNING: Restoring the database will OVERWRITE all existing products, customers, suppliers, and invoices. Do you want to continue?');
    if (!confirmRestore) return;

    setStatusMsg('Reading backup file...');
    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const text = evt.target?.result as string;
        const backup = JSON.parse(text);

        if (backup?.meta?.app !== 'ElectroMart') {
          throw new Error('Invalid file format: Backup file is not a valid Jiya\'s Arcade/ElectroMart backup.');
        }

        setStatusMsg('Clearing database tables...');
        await dbRun('DELETE FROM invoice_items');
        await dbRun('DELETE FROM invoices');
        await dbRun('DELETE FROM stock_transactions');
        await dbRun('DELETE FROM products');
        await dbRun('DELETE FROM customers');
        await dbRun('DELETE FROM suppliers');
        await dbRun('DELETE FROM users');
        await dbRun('DELETE FROM business_profile');

        const d = backup.data;

        // Restore Suppliers
        setStatusMsg('Restoring supplier profiles...');
        for (const s of (d.suppliers || [])) {
          await dbRun(
            'INSERT INTO suppliers (id, name, mobile, email, address, gstin, state, outstanding_balance) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
            [s.id, s.name, s.mobile, s.email, s.address, s.gstin, s.state, s.outstanding_balance]
          );
        }

        // Restore Customers
        setStatusMsg('Restoring customer profiles...');
        for (const c of (d.customers || [])) {
          await dbRun(
            'INSERT INTO customers (id, name, mobile, email, address, gstin, state, credit_limit, outstanding_balance) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
            [c.id, c.name, c.mobile, c.email, c.address, c.gstin, c.state, c.credit_limit, c.outstanding_balance]
          );
        }

        // Restore Products
        setStatusMsg('Restoring product master items...');
        for (const p of (d.products || [])) {
          await dbRun(
            `INSERT INTO products (id, name, sku, barcode, category, brand, unit, hsn_code, gst_percentage, 
                                   purchase_price, selling_price, mrp, opening_stock, current_stock, reserved_stock, available_stock, reorder_level, supplier_id, notes) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)`,
            [p.id, p.name, p.sku, p.barcode, p.category, p.brand, p.unit, p.hsn_code, p.gst_percentage,
             p.purchase_price, p.selling_price, p.mrp, p.opening_stock, p.current_stock, p.reserved_stock, p.available_stock, p.reorder_level, p.supplier_id, p.notes]
          );
        }

        // Restore Invoices
        setStatusMsg('Restoring billing invoices...');
        for (const inv of (d.invoices || [])) {
          await dbRun(
            `INSERT INTO invoices (id, invoice_number, customer_id, date, subtotal, gst_amount, discount, total, payment_mode, status, type, notes, gst_irn, einvoice_ref, eway_bill_no) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
            [inv.id, inv.invoice_number, inv.customer_id, inv.date, inv.subtotal, inv.gst_amount, inv.discount, inv.total, inv.payment_mode, inv.status, inv.type, inv.notes, inv.gst_irn, inv.einvoice_ref, inv.eway_bill_no]
          );
        }

        // Restore Invoice Items
        setStatusMsg('Restoring sales transaction line items...');
        for (const it of (d.invoice_items || [])) {
          await dbRun(
            `INSERT INTO invoice_items (id, invoice_id, product_id, name, quantity, price, gst_percentage, gst_amount, discount, total) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [it.id, it.invoice_id, it.product_id, it.name, it.quantity, it.price, it.gst_percentage, it.gst_amount, it.discount, it.total]
          );
        }

        // Restore Stock Transactions
        setStatusMsg('Restoring stock logs...');
        for (const st of (d.stock_transactions || [])) {
          await dbRun(
            'INSERT INTO stock_transactions (id, product_id, transaction_type, quantity, reference_id, notes, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)',
            [st.id, st.product_id, st.transaction_type, st.quantity, st.reference_id, st.notes, st.created_at]
          );
        }

        // Restore Users
        setStatusMsg('Restoring user accounts...');
        for (const u of (d.users || [])) {
          await dbRun(
            'INSERT INTO users (id, username, password_hash, role, created_at) VALUES ($1, $2, $3, $4, $5)',
            [u.id, u.username, u.password_hash, u.role, u.created_at]
          );
        }

        // Restore Business Profile
        setStatusMsg('Restoring business profile...');
        if (d.business_profile && d.business_profile.length > 0) {
          const bp = d.business_profile[0];
          await dbRun(
            'INSERT INTO business_profile (id, name, address, phone, gstin, email, state, logo_base64, bank_details, upi_id) VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8, $9)',
            [bp.name, bp.address, bp.phone, bp.gstin, bp.email, bp.state, bp.logo_base64, bp.bank_details, bp.upi_id]
          );
        }

        setStatusMsg('🎉 Database restoration was 100% successful!');
        alert('🎉 Database successfully restored from backup.');
        loadUsers();
        loadProfile();
      } catch (err: any) {
        setStatusMsg(`Restore failed: ${err.message || err}`);
        alert(`Restore failed: ${err.message || err}`);
      }
    };
    reader.readAsText(file);
  };

  return (
    <div>
      <div className="section-header">
        <h3>System Settings & Security Management</h3>
      </div>

      {/* Business Profile card (Full Width) */}
      <div className="card" style={{ marginBottom: '24px' }}>
        <h4 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '16px', color: 'var(--dark)' }}>
          🏢 Jiya's Arcade Profile Settings
        </h4>
        <form onSubmit={handleSaveProfile}>
          <div className="form-grid" style={{ marginBottom: '20px' }}>
            <div className="form-group">
              <label>Business Name</label>
              <input
                type="text"
                required
                value={profile.name}
                onChange={e => setProfile(prev => ({ ...prev, name: e.target.value }))}
              />
            </div>
            <div className="form-group">
              <label>Phone Number</label>
              <input
                type="text"
                required
                value={profile.phone}
                onChange={e => setProfile(prev => ({ ...prev, phone: e.target.value }))}
              />
            </div>
            <div className="form-group">
              <label>GST Number (GSTIN)</label>
              <input
                type="text"
                required
                value={profile.gstin}
                onChange={e => setProfile(prev => ({ ...prev, gstin: e.target.value }))}
              />
            </div>
            <div className="form-group">
              <label>Email Address</label>
              <input
                type="email"
                required
                value={profile.email}
                onChange={e => setProfile(prev => ({ ...prev, email: e.target.value }))}
              />
            </div>
            <div className="form-group">
              <label>State & Code</label>
              <input
                type="text"
                required
                placeholder="e.g. 19-West Bengal"
                value={profile.state}
                onChange={e => setProfile(prev => ({ ...prev, state: e.target.value }))}
              />
            </div>
            <div className="form-group">
              <label>UPI ID (for billing display)</label>
              <input
                type="text"
                placeholder="e.g. jiyasarcade@okaxis"
                value={profile.upi_id}
                onChange={e => setProfile(prev => ({ ...prev, upi_id: e.target.value }))}
              />
            </div>
            <div className="form-group" style={{ gridColumn: '1 / -1' }}>
              <label>Business Location Address</label>
              <input
                type="text"
                required
                value={profile.address}
                onChange={e => setProfile(prev => ({ ...prev, address: e.target.value }))}
              />
            </div>
            <div className="form-group" style={{ gridColumn: '1 / -1' }}>
              <label>Bank Account Details (Bank Name, Account No, IFSC)</label>
              <textarea
                rows={2}
                placeholder="e.g. State Bank of India, A/c: 12345678901, IFSC: SBIN0001234"
                value={profile.bank_details}
                onChange={e => setProfile(prev => ({ ...prev, bank_details: e.target.value }))}
              />
            </div>
            <div className="form-group">
              <label>Company Logo Upload</label>
              <input
                type="file"
                accept="image/*"
                onChange={handleLogoUpload}
                style={{ padding: '6px' }}
              />
            </div>
            {profile.logo_base64 && (
              <div className="form-group" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                <label>Logo Preview</label>
                <img
                  src={profile.logo_base64}
                  alt="Logo Preview"
                  style={{ maxHeight: '60px', maxWidth: '160px', objectFit: 'contain', border: '1px dashed var(--border)', borderRadius: '6px', padding: '4px' }}
                />
              </div>
            )}
          </div>
          <button type="submit" className="btn btn-primary">
            💾 Save Profile Settings
          </button>
        </form>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '24px' }}>
        
        {/* Backup & Restore card */}
        <div className="card">
          <h4 style={{ fontSize: '15px', fontWeight: 700, marginBottom: '14px' }}>Data Preservation & Recovery</h4>
          <p style={{ color: 'var(--gray)', fontSize: '13px', marginBottom: '20px' }}>
            Safeguard your warehouse registry, supplier accounts, ledger files, and invoice copies by downloading local encrypted dumps.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div>
              <button className="btn btn-primary" onClick={handleBackup} style={{ width: '100%', justifyContent: 'center' }}>
                📥 One-Click Backup Database
              </button>
            </div>
            
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: '16px' }}>
              <label className="btn btn-secondary" style={{ width: '100%', justifyContent: 'center', cursor: 'pointer' }}>
                📤 One-Click Restore Database
                <input type="file" accept=".json" onChange={handleRestore} style={{ display: 'none' }} />
              </label>
            </div>

            {statusMsg && (
              <div style={{ background: 'var(--brand-light)', padding: '10px 14px', borderRadius: '6px', fontSize: '12px', color: 'var(--brand-dark)', fontWeight: 600, textAlign: 'center' }}>
                {statusMsg}
              </div>
            )}
          </div>
        </div>

        {/* Security & Roles card */}
        <div className="card">
          <h4 style={{ fontSize: '15px', fontWeight: 700, marginBottom: '14px' }}>User Access Control (RBAC)</h4>
          
          <form onSubmit={handleCreateUser} style={{ marginBottom: '20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <div className="form-group">
                <label>Username</label>
                <input 
                  type="text" 
                  required 
                  placeholder="e.g. staff_sales" 
                  value={newUser.username} 
                  onChange={e => setNewUser(prev => ({ ...prev, username: e.target.value }))}
                />
              </div>
              <div className="form-group">
                <label>Role</label>
                <select value={newUser.role} onChange={e => setNewUser(prev => ({ ...prev, role: e.target.value }))}>
                  <option value="Staff">Staff Operator</option>
                  <option value="Admin">System Admin</option>
                </select>
              </div>
            </div>
            <div className="form-group">
              <label>Password</label>
              <input 
                type="password" 
                required 
                placeholder="••••••••" 
                value={newUser.password} 
                onChange={e => setNewUser(prev => ({ ...prev, password: e.target.value }))}
              />
            </div>
            <button type="submit" className="btn btn-secondary btn-sm" style={{ alignSelf: 'flex-start' }}>
              + Create User Profile
            </button>
          </form>

          <h5 style={{ fontSize: '12px', fontWeight: 700, color: 'var(--gray)', textTransform: 'uppercase', marginBottom: '10px' }}>
            Authorized Accounts Registry
          </h5>
          {loading ? (
            <p style={{ fontSize: '12px' }}>Loading accounts...</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Username</th>
                    <th>Role</th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map(u => (
                    <tr key={u.id}>
                      <td style={{ fontWeight: 600 }}>{u.username}</td>
                      <td>
                        <span className={`badge ${u.role === 'Admin' ? 'badge-green' : 'badge-gray'}`} style={{ fontSize: '10px' }}>
                          {u.role}
                        </span>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <button 
                          className="btn btn-danger btn-sm"
                          disabled={u.username === 'admin'}
                          onClick={() => handleDeleteUser(u.id, u.username)}
                          style={{ padding: '3px 8px', fontSize: '10px' }}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
