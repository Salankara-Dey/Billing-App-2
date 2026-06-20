'use client';

import React, { useState, useEffect } from 'react';
import { dbQuery, dbRun } from '@/lib/api';

interface Supplier {
  id: number;
  name: string;
  mobile: string;
  email: string;
  address: string;
  gstin: string;
  state: string;
  outstanding_balance: number;
  created_at: string;
}

interface PurchaseOrder {
  id: number;
  po_number: string;
  supplier_name: string;
  date: string;
  total: number;
  status: string;
}

export default function SuppliersView() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'directory' | 'orders'>('directory');
  const [search, setSearch] = useState('');

  // Modals
  const [showSupplierModal, setShowSupplierModal] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [showPOModal, setShowPOModal] = useState(false);

  // Form states
  const [supplierForm, setSupplierForm] = useState({
    name: '', mobile: '', email: '', address: '', gstin: '', state: 'Odisha', outstanding_balance: '0'
  });

  const [poForm, setPoForm] = useState({
    supplier_id: '',
    date: new Date().toISOString().split('T')[0],
    total: '0',
    status: 'Sent',
    notes: ''
  });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const sups = await dbQuery('SELECT * FROM suppliers ORDER BY id DESC');
      setSuppliers(sups);

      const pos = await dbQuery(`
        SELECT po.*, s.name as supplier_name 
        FROM purchase_orders po 
        JOIN suppliers s ON po.supplier_id = s.id 
        ORDER BY po.id DESC
      `);
      setPurchaseOrders(pos);
    } catch (err) {
      console.error('Failed to load supplier records:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenAddSupplier = () => {
    setEditingSupplier(null);
    setSupplierForm({
      name: '', mobile: '', email: '', address: '', gstin: '', state: 'Odisha', outstanding_balance: '0'
    });
    setShowSupplierModal(true);
  };

  const handleOpenEditSupplier = (s: Supplier) => {
    setEditingSupplier(s);
    setSupplierForm({
      name: s.name, mobile: s.mobile || '', email: s.email || '',
      address: s.address || '', gstin: s.gstin || '', state: s.state || 'Odisha',
      outstanding_balance: s.outstanding_balance.toString()
    });
    setShowSupplierModal(true);
  };

  const handleSaveSupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supplierForm.name) return alert('Supplier Name is required');

    const args = [
      supplierForm.name,
      supplierForm.mobile,
      supplierForm.email,
      supplierForm.address,
      supplierForm.gstin,
      supplierForm.state,
      parseFloat(supplierForm.outstanding_balance) || 0
    ];

    try {
      if (editingSupplier) {
        await dbRun(`
          UPDATE suppliers 
          SET name=$1, mobile=$2, email=$3, address=$4, gstin=$5, state=$6, outstanding_balance=$7
          WHERE id=${editingSupplier.id}
        `, args);
      } else {
        await dbRun(`
          INSERT INTO suppliers (name, mobile, email, address, gstin, state, outstanding_balance)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
        `, args);
      }
      setShowSupplierModal(false);
      loadData();
    } catch (err: any) {
      alert(`Save failed: ${err.message || err}`);
    }
  };

  const handleDeleteSupplier = async (id: number) => {
    try {
      const hasProd = await dbQuery('SELECT COUNT(*) as cnt FROM products WHERE supplier_id = $1', [id]);
      if (hasProd[0]?.cnt > 0) {
        return alert(`Cannot delete supplier: ${hasProd[0].cnt} products are associated with this vendor.`);
      }

      if (!confirm('Delete this supplier profile?')) return;

      await dbRun('DELETE FROM suppliers WHERE id = $1', [id]);
      loadData();
    } catch (err: any) {
      alert(`Delete failed: ${err.message || err}`);
    }
  };

  const handleCreatePO = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!poForm.supplier_id) return alert('Please select a supplier');
    const totalVal = parseFloat(poForm.total) || 0;
    if (totalVal <= 0) return alert('Total purchase amount must be greater than zero');

    const poNumber = `PO-${Date.now().toString().slice(-6)}`;

    try {
      // 1. Create Purchase Order
      await dbRun(`
        INSERT INTO purchase_orders (po_number, supplier_id, date, total, status)
        VALUES ($1, $2, $3, $4, $5)
      `, [poNumber, parseInt(poForm.supplier_id), poForm.date, totalVal, poForm.status]);

      // 2. If PO status is "Received", increase outstanding balance
      if (poForm.status === 'Received') {
        await dbRun(`
          UPDATE suppliers 
          SET outstanding_balance = outstanding_balance + $1 
          WHERE id = $2
        `, [totalVal, parseInt(poForm.supplier_id)]);
      }

      setShowPOModal(false);
      loadData();
      alert(`✅ Purchase Order ${poNumber} created successfully!`);
    } catch (err: any) {
      alert(`PO creation failed: ${err.message || err}`);
    }
  };

  const filteredSuppliers = suppliers.filter(s => 
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    (s.mobile && s.mobile.includes(search)) ||
    (s.gstin && s.gstin.toLowerCase().includes(search.toLowerCase()))
  );

  const fmtCurrency = (n: number) => {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);
  };

  return (
    <div>
      {/* Navigation tabs */}
      <div style={{ display: 'flex', gap: '10px', marginBottom: '20px', borderBottom: '1px solid var(--border)', paddingBottom: '10px' }}>
        <button 
          className={`btn ${activeTab === 'directory' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setActiveTab('directory')}
        >
          🏭 Suppliers Directory
        </button>
        <button 
          className={`btn ${activeTab === 'orders' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setActiveTab('orders')}
        >
          📦 Purchase Orders (PO)
        </button>
      </div>

      {activeTab === 'directory' && (
        <>
          <div className="section-header">
            <h3>Registered Vendor Profiles ({filteredSuppliers.length} vendors)</h3>
            <button className="btn btn-primary" onClick={handleOpenAddSupplier}>+ Register Supplier</button>
          </div>

          <div className="card" style={{ marginBottom: '20px', padding: '16px 20px' }}>
            <input 
              type="text" 
              placeholder="Search by vendor name, mobile or GSTIN..." 
              value={search} 
              onChange={e => setSearch(e.target.value)} 
            />
          </div>

          <div className="card" style={{ padding: 0 }}>
            {loading ? (
              <div style={{ padding: '24px', textAlign: 'center' }}>Loading vendor profiles...</div>
            ) : filteredSuppliers.length === 0 ? (
              <div style={{ padding: '24px', textAlign: 'center', color: 'var(--gray)' }}>No suppliers match your search filters.</div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Vendor details</th>
                      <th>Contact Details</th>
                      <th>GSTIN</th>
                      <th>Billing State</th>
                      <th>Outstanding Payable</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredSuppliers.map(s => (
                      <tr key={s.id}>
                        <td>
                          <div style={{ fontWeight: 600, color: 'var(--dark)' }}>{s.name}</div>
                          <div style={{ fontSize: '11px', color: 'var(--gray)' }}>Vendor ID: SUP-{String(s.id).padStart(4, '0')}</div>
                        </td>
                        <td>
                          <div style={{ fontSize: '13px' }}>📞 {s.mobile || '—'}</div>
                          {s.email && <div style={{ fontSize: '11px', color: 'var(--gray)' }}>✉️ {s.email}</div>}
                        </td>
                        <td>{s.gstin ? <code style={{ fontSize: '11px' }}>{s.gstin}</code> : <span style={{ color: 'var(--gray)' }}>Unregistered</span>}</td>
                        <td>{s.state}</td>
                        <td style={{ fontWeight: 700, color: s.outstanding_balance > 0 ? 'var(--red)' : 'var(--green)' }}>
                          {fmtCurrency(s.outstanding_balance)}
                        </td>
                        <td>
                          <div className="actions-cell">
                            <button className="btn btn-secondary btn-sm" onClick={() => handleOpenEditSupplier(s)}>✏️ Edit</button>
                            <button className="btn btn-danger btn-sm" onClick={() => handleDeleteSupplier(s.id)}>🗑️</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {activeTab === 'orders' && (
        <>
          <div className="section-header">
            <h3>Vendor Purchase Orders & Procurement Bills</h3>
            <button className="btn btn-primary" onClick={() => setShowPOModal(true)}>+ Generate Purchase Order</button>
          </div>

          <div className="card" style={{ padding: 0 }}>
            {purchaseOrders.length === 0 ? (
              <p style={{ padding: '24px', textAlign: 'center', color: 'var(--gray)' }}>No purchase orders issued yet.</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>PO Number</th>
                      <th>Supplier Name</th>
                      <th>Date</th>
                      <th>Total Value</th>
                      <th>Procurement Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {purchaseOrders.map(po => (
                      <tr key={po.id}>
                        <td style={{ fontWeight: 600, color: 'var(--brand)' }}>{po.po_number}</td>
                        <td>{po.supplier_name}</td>
                        <td>{po.date}</td>
                        <td style={{ fontWeight: 700 }}>{fmtCurrency(po.total)}</td>
                        <td>
                          <span className={`badge ${
                            po.status === 'Received' ? 'badge-green' : po.status === 'Sent' ? 'badge-blue' : 'badge-gray'
                          }`}>
                            {po.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {/* Supplier Profile Modal */}
      {showSupplierModal && (
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth: '600px' }}>
            <h3 className="modal-title">{editingSupplier ? 'Modify Vendor Profile' : 'Register New Vendor Profile'}</h3>
            <form onSubmit={handleSaveSupplier}>
              <div className="form-grid" style={{ marginBottom: '24px' }}>
                <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                  <label>Supplier / Vendor Company Name *</label>
                  <input 
                    type="text" 
                    required 
                    value={supplierForm.name} 
                    onChange={e => setSupplierForm(prev => ({ ...prev, name: e.target.value }))} 
                  />
                </div>
                <div className="form-group">
                  <label>Mobile Number</label>
                  <input 
                    type="text" 
                    value={supplierForm.mobile} 
                    onChange={e => setSupplierForm(prev => ({ ...prev, mobile: e.target.value }))} 
                  />
                </div>
                <div className="form-group">
                  <label>Email Address</label>
                  <input 
                    type="email" 
                    value={supplierForm.email} 
                    onChange={e => setSupplierForm(prev => ({ ...prev, email: e.target.value }))} 
                  />
                </div>
                <div className="form-group">
                  <label>GSTIN / Tax ID</label>
                  <input 
                    type="text" 
                    placeholder="21XXXXX1234X1ZX"
                    value={supplierForm.gstin} 
                    onChange={e => setSupplierForm(prev => ({ ...prev, gstin: e.target.value }))} 
                  />
                </div>
                <div className="form-group">
                  <label>Vendor Billing State</label>
                  <input 
                    type="text" 
                    value={supplierForm.state} 
                    onChange={e => setSupplierForm(prev => ({ ...prev, state: e.target.value }))} 
                  />
                </div>
                <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                  <label>Initial Outstanding Payable Balance (INR)</label>
                  <input 
                    type="number" 
                    value={supplierForm.outstanding_balance} 
                    onChange={e => setSupplierForm(prev => ({ ...prev, outstanding_balance: e.target.value }))} 
                  />
                </div>
                <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                  <label>Supplier Office Address</label>
                  <textarea 
                    value={supplierForm.address} 
                    rows={2}
                    onChange={e => setSupplierForm(prev => ({ ...prev, address: e.target.value }))} 
                  />
                </div>
              </div>
              <div style={{ display: 'flex', gap: '10px' }}>
                <button type="submit" className="btn btn-primary">{editingSupplier ? 'Update Vendor' : 'Save Vendor'}</button>
                <button type="button" className="btn btn-secondary" onClick={() => setShowSupplierModal(false)}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* PO generation Modal */}
      {showPOModal && (
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth: '500px' }}>
            <h3 className="modal-title">Issue Purchase Order</h3>
            <form onSubmit={handleCreatePO}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginBottom: '24px' }}>
                <div className="form-group">
                  <label>Select Vendor / Supplier *</label>
                  <select 
                    required 
                    value={poForm.supplier_id} 
                    onChange={e => setPoForm(prev => ({ ...prev, supplier_id: e.target.value }))}
                  >
                    <option value="">— Select Vendor —</option>
                    {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label>Procurement Date</label>
                  <input 
                    type="date" 
                    required 
                    value={poForm.date} 
                    onChange={e => setPoForm(prev => ({ ...prev, date: e.target.value }))} 
                  />
                </div>
                <div className="form-group">
                  <label>Total Bill Amount (excl. GST, INR) *</label>
                  <input 
                    type="number" 
                    step="0.01" 
                    required 
                    value={poForm.total} 
                    onChange={e => setPoForm(prev => ({ ...prev, total: e.target.value }))} 
                  />
                </div>
                <div className="form-group">
                  <label>Initial Status</label>
                  <select 
                    value={poForm.status} 
                    onChange={e => setPoForm(prev => ({ ...prev, status: e.target.value }))}
                  >
                    <option value="Draft">Draft</option>
                    <option value="Sent">Sent / Order Placed</option>
                    <option value="Received">Received / Invoiced</option>
                  </select>
                </div>
              </div>
              <div style={{ display: 'flex', gap: '10px' }}>
                <button type="submit" className="btn btn-primary">Create Procurement Bill</button>
                <button type="button" className="btn btn-secondary" onClick={() => setShowPOModal(false)}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
