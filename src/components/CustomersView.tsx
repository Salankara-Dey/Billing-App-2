'use client';

import React, { useState, useEffect } from 'react';
import { dbQuery, dbRun } from '@/lib/api';

interface Customer {
  id: number;
  name: string;
  mobile: string;
  email: string;
  address: string;
  gstin: string;
  state: string;
  credit_limit: number;
  outstanding_balance: number;
  created_at: string;
}

interface InvoiceRecord {
  id: number;
  invoice_number: string;
  date: string;
  total: number;
  status: string;
}

export default function CustomersView() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  
  // Modal states
  const [showModal, setShowModal] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [selectedLedgerCustomer, setSelectedLedgerCustomer] = useState<Customer | null>(null);
  const [customerInvoices, setCustomerInvoices] = useState<InvoiceRecord[]>([]);

  // Form states
  const [form, setForm] = useState({
    name: '', mobile: '', email: '', address: '', gstin: '', state: 'Odisha', credit_limit: '50000'
  });

  useEffect(() => {
    loadCustomers();
  }, []);

  const loadCustomers = async () => {
    setLoading(true);
    try {
      // Calculate outstanding balances dynamically by summing unpaid invoices for each customer
      // and updating outstanding_balance in database, or we can just fetch dynamically!
      // Dynamically fetching is much safer to avoid out-of-sync states.
      const res = await dbQuery(`
        SELECT c.*, 
               COALESCE((SELECT SUM(total) FROM invoices WHERE customer_id = c.id AND status = 'unpaid'), 0) as outstanding_balance
        FROM customers c
        ORDER BY c.id DESC
      `);
      setCustomers(res);
    } catch (err) {
      console.error('Failed to load customers:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenAdd = () => {
    setEditingCustomer(null);
    setForm({
      name: '', mobile: '', email: '', address: '', gstin: '', state: 'Odisha', credit_limit: '50000'
    });
    setShowModal(true);
  };

  const handleOpenEdit = (c: Customer) => {
    setEditingCustomer(c);
    setForm({
      name: c.name, mobile: c.mobile || '', email: c.email || '',
      address: c.address || '', gstin: c.gstin || '', state: p(c.state, 'Odisha'),
      credit_limit: p(c.credit_limit, 50000).toString()
    });
    setShowModal(true);
  };

  const p = (v: any, df: any) => v === null || v === undefined ? df : v;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name) return alert('Customer Name is required');

    const args = [
      form.name,
      form.mobile,
      form.email,
      form.address,
      form.gstin,
      form.state,
      parseFloat(form.credit_limit) || 0
    ];

    try {
      if (editingCustomer) {
        await dbRun(`
          UPDATE customers 
          SET name=$1, mobile=$2, email=$3, address=$4, gstin=$5, state=$6, credit_limit=$7
          WHERE id=${editingCustomer.id}
        `, args);
      } else {
        await dbRun(`
          INSERT INTO customers (name, mobile, email, address, gstin, state, credit_limit, outstanding_balance)
          VALUES ($1, $2, $3, $4, $5, $6, $7, 0)
        `, args);
      }
      setShowModal(false);
      loadCustomers();
    } catch (err: any) {
      alert(`Failed to save customer: ${err.message || err}`);
    }
  };

  const handleDelete = async (c: Customer) => {
    // Check if customer has invoices
    try {
      const invCount = await dbQuery('SELECT COUNT(*) as cnt FROM invoices WHERE customer_id = $1', [c.id]);
      if (invCount[0]?.cnt > 0) {
        return alert(`Cannot delete customer: ${c.name} has ${invCount[0].cnt} registered invoices.`);
      }

      if (!confirm(`Delete customer ${c.name}?`)) return;

      await dbRun('DELETE FROM customers WHERE id = $1', [c.id]);
      loadCustomers();
    } catch (err: any) {
      alert(`Deletion failed: ${err.message || err}`);
    }
  };

  const handleViewLedger = async (c: Customer) => {
    setSelectedLedgerCustomer(c);
    try {
      const invs = await dbQuery(`
        SELECT id, invoice_number, date, total, status 
        FROM invoices 
        WHERE customer_id = $1 
        ORDER BY id DESC
      `, [c.id]);
      setCustomerInvoices(invs);
    } catch (err) {
      console.error('Failed to load ledger invoices:', err);
    }
  };

  const filteredCustomers = customers.filter(c => 
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    (c.mobile && c.mobile.includes(search)) ||
    (c.email && c.email.toLowerCase().includes(search.toLowerCase()))
  );

  const fmtCurrency = (n: number) => {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);
  };

  return (
    <div>
      <div className="section-header">
        <h3>Customer Master Directory ({filteredCustomers.length} profiles)</h3>
        <button className="btn btn-primary" onClick={handleOpenAdd}>+ Register Customer</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: selectedLedgerCustomer ? '1fr 350px' : '1fr', gap: '20px', alignItems: 'start' }}>
        
        {/* Customer list */}
        <div>
          <div className="card" style={{ marginBottom: '20px', padding: '16px 20px' }}>
            <input 
              type="text" 
              placeholder="Search by name, phone or email..." 
              value={search} 
              onChange={e => setSearch(e.target.value)} 
            />
          </div>

          <div className="card" style={{ padding: 0 }}>
            {loading ? (
              <div style={{ padding: '24px', textAlign: 'center' }}>Loading customers...</div>
            ) : filteredCustomers.length === 0 ? (
              <div style={{ padding: '24px', textAlign: 'center', color: 'var(--gray)' }}>No customers found.</div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Customer Details</th>
                      <th>Contact Details</th>
                      <th>GSTIN</th>
                      <th>State</th>
                      <th>Credit Limit</th>
                      <th>Outstanding Balance</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredCustomers.map(c => (
                      <tr key={c.id} style={{ background: selectedLedgerCustomer?.id === c.id ? 'var(--brand-light)' : 'inherit' }}>
                        <td>
                          <div style={{ fontWeight: 600, color: 'var(--dark)' }}>{c.name}</div>
                          <div style={{ fontSize: '11px', color: 'var(--gray)' }}>ID: CUST-{String(c.id).padStart(4, '0')}</div>
                        </td>
                        <td>
                          <div style={{ fontSize: '13px' }}>📞 {c.mobile || '—'}</div>
                          {c.email && <div style={{ fontSize: '11px', color: 'var(--gray)' }}>✉️ {c.email}</div>}
                        </td>
                        <td>{c.gstin ? <code style={{ fontSize: '11px' }}>{c.gstin}</code> : <span style={{ color: 'var(--gray)' }}>Unregistered</span>}</td>
                        <td>{c.state}</td>
                        <td>{fmtCurrency(c.credit_limit)}</td>
                        <td style={{ fontWeight: 700, color: c.outstanding_balance > 0 ? 'var(--red)' : 'var(--green)' }}>
                          {fmtCurrency(c.outstanding_balance)}
                        </td>
                        <td>
                          <div className="actions-cell">
                            <button className="btn btn-secondary btn-sm" onClick={() => handleViewLedger(c)}>📊 Ledger</button>
                            <button className="btn btn-secondary btn-sm" onClick={() => handleOpenEdit(c)}>✏️</button>
                            <button className="btn btn-danger btn-sm" onClick={() => handleDelete(c)}>🗑️</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Ledger view panel on the right */}
        {selectedLedgerCustomer && (
          <div className="card" style={{ animation: 'slideUp 0.2s ease-out' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
              <div>
                <h4 style={{ fontSize: '15px', fontWeight: 700 }}>Customer Ledger</h4>
                <p style={{ fontSize: '12px', color: 'var(--gray)', marginTop: '2px' }}>{selectedLedgerCustomer.name}</p>
              </div>
              <button 
                style={{ background: 'none', border: 'none', fontSize: '18px', cursor: 'pointer', color: 'var(--gray)' }}
                onClick={() => setSelectedLedgerCustomer(null)}
              >
                ✕
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', background: 'var(--light)', padding: '12px', borderRadius: '8px', marginBottom: '16px', fontSize: '12px' }}>
              <div>Credit Limit: <strong>{fmtCurrency(selectedLedgerCustomer.credit_limit)}</strong></div>
              <div>Outstanding: <strong style={{ color: 'var(--red)' }}>{fmtCurrency(selectedLedgerCustomer.outstanding_balance)}</strong></div>
              {selectedLedgerCustomer.address && <div>Address: {selectedLedgerCustomer.address}</div>}
            </div>

            <h5 style={{ fontSize: '12px', fontWeight: 700, marginBottom: '10px', color: 'var(--gray)', textTransform: 'uppercase' }}>Transactions History</h5>
            {customerInvoices.length === 0 ? (
              <p style={{ color: 'var(--gray)', fontSize: '12px' }}>No invoices registered for this client.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '300px', overflowY: 'auto' }}>
                {customerInvoices.map(inv => (
                  <div 
                    key={inv.id}
                    style={{
                      border: '1px solid var(--border)',
                      borderRadius: '6px',
                      padding: '10px',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      fontSize: '12px',
                      background: 'var(--white)'
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 600, color: 'var(--brand)' }}>{inv.invoice_number}</div>
                      <div style={{ color: 'var(--gray)', fontSize: '11px', marginTop: '2px' }}>{inv.date}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontWeight: 700 }}>{fmtCurrency(inv.total)}</div>
                      <div className={`badge ${inv.status === 'paid' ? 'badge-green' : 'badge-red'}`} style={{ fontSize: '9px', padding: '1px 6px', marginTop: '4px' }}>
                        {inv.status}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Add / Edit Customer Modal */}
      {showModal && (
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth: '600px' }}>
            <h3 className="modal-title">{editingCustomer ? 'Edit Customer Details' : 'Register New Customer Profile'}</h3>
            <form onSubmit={handleSave}>
              <div className="form-grid" style={{ marginBottom: '24px' }}>
                <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                  <label>Customer Full Name *</label>
                  <input 
                    type="text" 
                    required 
                    value={form.name} 
                    onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))} 
                  />
                </div>
                <div className="form-group">
                  <label>Mobile Number</label>
                  <input 
                    type="text" 
                    value={form.mobile} 
                    onChange={e => setForm(prev => ({ ...prev, mobile: e.target.value }))} 
                  />
                </div>
                <div className="form-group">
                  <label>Email Address</label>
                  <input 
                    type="email" 
                    value={form.email} 
                    onChange={e => setForm(prev => ({ ...prev, email: e.target.value }))} 
                  />
                </div>
                <div className="form-group">
                  <label>GSTIN / Tax ID</label>
                  <input 
                    type="text" 
                    placeholder="21XXXXX1234X1ZX"
                    value={form.gstin} 
                    onChange={e => setForm(prev => ({ ...prev, gstin: e.target.value }))} 
                  />
                </div>
                <div className="form-group">
                  <label>Billing State</label>
                  <input 
                    type="text" 
                    value={form.state} 
                    onChange={e => setForm(prev => ({ ...prev, state: e.target.value }))} 
                  />
                </div>
                <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                  <label>Credit Limit (INR)</label>
                  <input 
                    type="number" 
                    value={form.credit_limit} 
                    onChange={e => setForm(prev => ({ ...prev, credit_limit: e.target.value }))} 
                  />
                </div>
                <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                  <label>Billing Address</label>
                  <textarea 
                    value={form.address} 
                    rows={2}
                    onChange={e => setForm(prev => ({ ...prev, address: e.target.value }))} 
                  />
                </div>
              </div>
              <div style={{ display: 'flex', gap: '10px' }}>
                <button type="submit" className="btn btn-primary">{editingCustomer ? 'Update Profile' : 'Save Profile'}</button>
                <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
