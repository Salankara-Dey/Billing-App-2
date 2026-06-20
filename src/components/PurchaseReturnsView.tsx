'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { dbQuery, dbRun } from '@/lib/api';

interface Supplier {
  id: number;
  name: string;
}

interface Product {
  id: number;
  name: string;
  current_stock: number;
  purchase_price: number;
  gst_percentage: number;
}

export default function PurchaseReturnsView() {
  const [activeTab, setActiveTab] = useState<'create' | 'history'>('create');
  
  // Create State
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  
  const [supplierId, setSupplierId] = useState('');
  const [productId, setProductId] = useState('');
  const [returnDate, setReturnDate] = useState(new Date().toISOString().split('T')[0]);
  const [quantity, setQuantity] = useState('1');
  const [customPrice, setCustomPrice] = useState('');
  const [gstPercentage, setGstPercentage] = useState('18');
  const [notes, setNotes] = useState('');

  // History State
  const [returnHistory, setReturnHistory] = useState<any[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  useEffect(() => {
    loadParameters();
  }, []);

  useEffect(() => {
    if (activeTab === 'history') {
      loadHistory();
    }
  }, [activeTab]);

  const loadParameters = async () => {
    try {
      const sups = await dbQuery('SELECT id, name FROM suppliers ORDER BY name ASC');
      setSuppliers(sups);

      const prods = await dbQuery('SELECT id, name, current_stock, purchase_price, gst_percentage FROM products ORDER BY name ASC');
      setProducts(prods);
    } catch (err) {
      console.error('Failed to load purchase return parameters:', err);
    }
  };

  const loadHistory = async () => {
    setHistoryLoading(true);
    try {
      const res = await dbQuery(`
        SELECT pr.*, s.name as supplier_name 
        FROM purchase_returns pr 
        JOIN suppliers s ON pr.supplier_id = s.id 
        ORDER BY pr.id DESC
      `);
      setReturnHistory(res);
    } catch (err) {
      console.error('Failed to load purchase returns history:', err);
    } finally {
      setHistoryLoading(false);
    }
  };

  // Populate fields when product changes
  const selectedProduct = useMemo(() => {
    if (!productId) return null;
    return products.find(p => p.id === parseInt(productId)) || null;
  }, [productId, products]);

  useEffect(() => {
    if (selectedProduct) {
      setCustomPrice(selectedProduct.purchase_price.toString());
      setGstPercentage(selectedProduct.gst_percentage.toString());
    } else {
      setCustomPrice('');
      setGstPercentage('18');
    }
  }, [selectedProduct]);

  // Calculations
  const returnTotals = useMemo(() => {
    const qty = parseInt(quantity) || 0;
    const price = parseFloat(customPrice) || 0;
    const gst = parseFloat(gstPercentage) || 0;

    const subtotal = price * qty;
    const gstAmt = subtotal * (gst / 100);
    const total = subtotal + gstAmt;

    return {
      subtotal: +subtotal.toFixed(2),
      gst_amount: +gstAmt.toFixed(2),
      total: Math.round(total)
    };
  }, [quantity, customPrice, gstPercentage]);

  const handleSubmitReturn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supplierId) return alert('Please select a supplier.');
    if (!productId) return alert('Please select a product.');
    
    const qty = parseInt(quantity) || 0;
    if (qty <= 0) return alert('Quantity must be greater than zero.');
    
    if (selectedProduct && selectedProduct.current_stock < qty) {
      return alert(`Cannot return ${qty} units. Current stock for "${selectedProduct.name}" is ${selectedProduct.current_stock}.`);
    }

    try {
      const returns = await dbQuery('SELECT return_number FROM purchase_returns');
      const nextRetNo = `PRET-${String(returns.length + 1).padStart(4, '0')}`;

      // 1. Save main purchase return
      const retRes = await dbRun(`
        INSERT INTO purchase_returns (return_number, supplier_id, return_date, subtotal, gst_amount, total, notes)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [nextRetNo, parseInt(supplierId), returnDate, returnTotals.subtotal, returnTotals.gst_amount, returnTotals.total, notes]);

      const purchaseReturnId = retRes.lastID;

      if (purchaseReturnId) {
        // 2. Save return item line
        await dbRun(`
          INSERT INTO purchase_return_items (purchase_return_id, product_id, name, quantity, price, gst_percentage, gst_amount, total)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `, [purchaseReturnId, parseInt(productId), selectedProduct?.name || 'Unknown', qty, parseFloat(customPrice) || 0, parseFloat(gstPercentage) || 0, returnTotals.gst_amount, returnTotals.total]);

        // 3. Stock Reversal (reduce stock)
        await dbRun(`
          UPDATE products 
          SET current_stock = MAX(0, current_stock - $1), available_stock = MAX(0, available_stock - $1) 
          WHERE id = $2
        `, [qty, parseInt(productId)]);

        // 4. Log stock movement
        await dbRun(`
          INSERT INTO stock_transactions (product_id, transaction_type, quantity, reference_id, notes)
          VALUES ($1, 'Stock Out', $2, $3, $4)
        `, [parseInt(productId), qty, nextRetNo, `Purchase Return to supplier`]);

        // 5. Update supplier outstanding balance (Supplier Credit Tracking)
        await dbRun(`
          UPDATE suppliers 
          SET outstanding_balance = MAX(0, outstanding_balance - $1) 
          WHERE id = $2
        `, [returnTotals.total, parseInt(supplierId)]);
      }

      alert(`✅ Purchase Return ${nextRetNo} logged successfully!\nStock reversed and supplier credit recorded.`);
      
      // Reset form
      setSupplierId('');
      setProductId('');
      setQuantity('1');
      setCustomPrice('');
      setNotes('');
      
      loadParameters();
      setActiveTab('history');
    } catch (err: any) {
      alert(`Failed to submit purchase return: ${err.message || err}`);
    }
  };

  const fmtCurrency = (n: number) => {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(n);
  };

  return (
    <div>
      {/* Navigation tabs */}
      <div style={{ display: 'flex', gap: '10px', marginBottom: '20px', borderBottom: '1px solid var(--border)', paddingBottom: '10px' }}>
        <button 
          className={`btn ${activeTab === 'create' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setActiveTab('create')}
        >
          🔁 Issue Supplier Return
        </button>
        <button 
          className={`btn ${activeTab === 'history' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setActiveTab('history')}
        >
          📚 Return Ledger History
        </button>
      </div>

      {activeTab === 'create' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: '24px', alignItems: 'start' }}>
          
          {/* Left Side: Create Return Form */}
          <div className="card">
            <h4 style={{ fontSize: '15px', fontWeight: 700, marginBottom: '20px' }}>Procurement Stock Reversal Form</h4>
            
            <form onSubmit={handleSubmitReturn}>
              <div className="form-grid" style={{ marginBottom: '20px' }}>
                
                <div className="form-group">
                  <label>Select Vendor / Supplier *</label>
                  <select 
                    required 
                    value={supplierId} 
                    onChange={e => setSupplierId(e.target.value)}
                  >
                    <option value="">— Select Vendor —</option>
                    {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>

                <div className="form-group">
                  <label>Select Product *</label>
                  <select 
                    required 
                    value={productId} 
                    onChange={e => setProductId(e.target.value)}
                  >
                    <option value="">— Select Product —</option>
                    {products.map(p => (
                      <option key={p.id} value={p.id}>
                        {p.name} (Stock: {p.current_stock})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label>Return Date</label>
                  <input 
                    type="date" 
                    required 
                    value={returnDate} 
                    onChange={e => setReturnDate(e.target.value)} 
                  />
                </div>

                <div className="form-group">
                  <label>Quantity to Return *</label>
                  <input 
                    type="number" 
                    min="1" 
                    required 
                    value={quantity} 
                    onChange={e => setQuantity(e.target.value)} 
                  />
                </div>

                <div className="form-group">
                  <label>Return Unit Price (excl. GST) *</label>
                  <input 
                    type="number" 
                    step="0.01" 
                    required 
                    value={customPrice} 
                    onChange={e => setCustomPrice(e.target.value)} 
                  />
                </div>

                <div className="form-group">
                  <label>GST Rate %</label>
                  <select 
                    value={gstPercentage} 
                    onChange={e => setGstPercentage(e.target.value)}
                  >
                    {[0, 5, 12, 18, 28].map(g => <option key={g} value={g}>{g}%</option>)}
                  </select>
                </div>

                <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                  <label>Reason / Notes</label>
                  <textarea 
                    value={notes} 
                    rows={2} 
                    placeholder="Provide details about return reason..."
                    onChange={e => setNotes(e.target.value)} 
                  />
                </div>

              </div>

              <button type="submit" className="btn btn-primary">
                💾 Submit Purchase Return
              </button>
            </form>
          </div>

          {/* Right Side: Valuation summary */}
          <div className="card">
            <h4 style={{ fontSize: '15px', fontWeight: 700, marginBottom: '16px' }}>Return Cost Valuation</h4>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', fontSize: '13px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--gray)' }}>Taxable Subtotal</span>
                <strong>{fmtCurrency(returnTotals.subtotal)}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--gray)' }}>GST Refund Claim</span>
                <strong>{fmtCurrency(returnTotals.gst_amount)}</strong>
              </div>
              <div style={{ display: 'flex', fontSize: '16px', borderTop: '1px solid var(--border)', paddingTop: '12px', justifyContent: 'space-between' }}>
                <span style={{ fontWeight: 700 }}>Total Credit Debit</span>
                <strong style={{ color: 'var(--red)' }}>{fmtCurrency(returnTotals.total)}</strong>
              </div>
            </div>

            {selectedProduct && (
              <div style={{ background: '#f8fafc', padding: '12px', borderRadius: '8px', marginTop: '20px', fontSize: '12px', border: '1px dashed var(--border)' }}>
                <strong>Product Check:</strong><br/>
                Current Stock: {selectedProduct.current_stock}<br/>
                Available after return: {selectedProduct.current_stock - (parseInt(quantity) || 0)}
              </div>
            )}
          </div>

        </div>
      )}

      {activeTab === 'history' && (
        <>
          <div className="section-header">
            <h3>Supplier Purchase Return Records</h3>
          </div>

          <div className="card" style={{ padding: 0 }}>
            {historyLoading ? (
              <p style={{ padding: '24px', textAlign: 'center' }}>Loading history...</p>
            ) : returnHistory.length === 0 ? (
              <p style={{ padding: '24px', textAlign: 'center', color: 'var(--gray)' }}>No purchase returns recorded yet.</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Return Reference</th>
                      <th>Date</th>
                      <th>Supplier / Vendor</th>
                      <th>Taxable Value</th>
                      <th>GST Amount</th>
                      <th>Total Balance Credit</th>
                      <th>Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {returnHistory.map(row => (
                      <tr key={row.id}>
                        <td style={{ fontWeight: 700, color: 'var(--red)' }}>{row.return_number}</td>
                        <td>{row.return_date}</td>
                        <td style={{ fontWeight: 600 }}>{row.supplier_name}</td>
                        <td>{fmtCurrency(row.subtotal)}</td>
                        <td>{fmtCurrency(row.gst_amount)}</td>
                        <td style={{ fontWeight: 700, color: 'var(--red)' }}>{fmtCurrency(row.total)}</td>
                        <td>{row.notes || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
