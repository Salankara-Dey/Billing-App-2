'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { dbQuery, dbRun } from '@/lib/api';

interface InvoiceItem {
  id: number;
  product_id: number | null;
  name: string;
  quantity: number;
  price: number;
  gst_percentage: number;
  gst_amount: number;
  total: number;
  returned_qty: number; // calculated
}

export default function SalesReturnsView() {
  const [activeTab, setActiveTab] = useState<'create' | 'history'>('create');
  const [searchInvoiceNo, setSearchInvoiceNo] = useState('');
  const [invoice, setInvoice] = useState<any | null>(null);
  const [invoiceItems, setInvoiceItems] = useState<InvoiceItem[]>([]);
  const [returnQuantities, setReturnQuantities] = useState<Record<number, number>>({}); // maps invoice_item.id to return qty
  const [returnNotes, setReturnNotes] = useState('');

  // History State
  const [returnHistory, setReturnHistory] = useState<any[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  useEffect(() => {
    if (activeTab === 'history') {
      loadHistory();
    }
  }, [activeTab]);

  const loadHistory = async () => {
    setHistoryLoading(true);
    try {
      const res = await dbQuery(`
        SELECT sr.*, i.invoice_number, COALESCE(c.name, 'Cash Customer') as customer_name 
        FROM sales_returns sr 
        JOIN invoices i ON sr.invoice_id = i.id 
        LEFT JOIN customers c ON i.customer_id = c.id
        ORDER BY sr.id DESC
      `);
      setReturnHistory(res);
    } catch (err) {
      console.error('Failed to load sales return history:', err);
    } finally {
      setHistoryLoading(false);
    }
  };

  const handleLookupInvoice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchInvoiceNo.trim()) return;

    try {
      const invs = await dbQuery(`
        SELECT i.*, COALESCE(c.name, 'Cash Customer') as customer_name, c.mobile as customer_phone
        FROM invoices i
        LEFT JOIN customers c ON i.customer_id = c.id
        WHERE i.invoice_number = $1
      `, [searchInvoiceNo.trim().toUpperCase()]);

      if (invs.length === 0) {
        alert(`No invoice found with number: ${searchInvoiceNo.toUpperCase()}`);
        setInvoice(null);
        setInvoiceItems([]);
        return;
      }

      const inv = invs[0];
      
      // Fetch items and calculate how many have already been returned
      const items = await dbQuery(`
        SELECT ii.*, 
               COALESCE((SELECT SUM(sri.quantity) FROM sales_return_items sri JOIN sales_returns sr ON sri.sales_return_id = sr.id WHERE sr.invoice_id = $1 AND sri.product_id = ii.product_id), 0) as returned_qty
        FROM invoice_items ii
        WHERE ii.invoice_id = $1
      `, [inv.id]);

      setInvoice(inv);
      setInvoiceItems(items);
      
      // Init return quantities to 0
      const initialQtys: Record<number, number> = {};
      items.forEach((it: any) => {
        initialQtys[it.id] = 0;
      });
      setReturnQuantities(initialQtys);
      setReturnNotes('');
    } catch (err) {
      console.error('Failed to lookup invoice for return:', err);
    }
  };

  const handleQtyChange = (itemId: number, maxQty: number, val: string) => {
    const qty = parseInt(val) || 0;
    if (qty < 0) return;
    if (qty > maxQty) {
      alert(`Cannot return more than purchased items (${maxQty} max).`);
      return;
    }
    setReturnQuantities(prev => ({ ...prev, [itemId]: qty }));
  };

  // Running return calculations
  const returnTotals = useMemo(() => {
    let subtotal = 0;
    let gst_amount = 0;
    let total = 0;

    invoiceItems.forEach(item => {
      const returnQty = returnQuantities[item.id] || 0;
      if (returnQty > 0) {
        // Recalculate based on original item price excluding GST
        const itemSubtotal = item.price * returnQty;
        const itemGst = itemSubtotal * (item.gst_percentage / 100);
        
        subtotal += itemSubtotal;
        gst_amount += itemGst;
        total += (itemSubtotal + itemGst);
      }
    });

    return {
      subtotal: +subtotal.toFixed(2),
      gst_amount: +gst_amount.toFixed(2),
      total: Math.round(total)
    };
  }, [invoiceItems, returnQuantities]);

  const handleSubmitReturn = async () => {
    if (!invoice) return;
    const hasItemsToReturn = Object.values(returnQuantities).some(q => q > 0);
    if (!hasItemsToReturn) return alert('Please enter return quantity for at least one item.');

    try {
      const returns = await dbQuery('SELECT return_number FROM sales_returns');
      const nextRetNo = `RET-${String(returns.length + 1).padStart(4, '0')}`;
      const returnDate = new Date().toISOString().split('T')[0];

      // 1. Create main sales return
      const retRes = await dbRun(`
        INSERT INTO sales_returns (return_number, invoice_id, return_date, subtotal, gst_amount, total, notes)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [nextRetNo, invoice.id, returnDate, returnTotals.subtotal, returnTotals.gst_amount, returnTotals.total, returnNotes]);

      const salesReturnId = retRes.lastID;

      if (salesReturnId) {
        // 2. Insert items and update stock
        for (const item of invoiceItems) {
          const returnQty = returnQuantities[item.id] || 0;
          if (returnQty > 0) {
            const itemSubtotal = item.price * returnQty;
            const itemGst = itemSubtotal * (item.gst_percentage / 100);
            
            await dbRun(`
              INSERT INTO sales_return_items (sales_return_id, product_id, name, quantity, price, gst_percentage, gst_amount, total)
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            `, [salesReturnId, item.product_id, item.name, returnQty, item.price, item.gst_percentage, +itemGst.toFixed(2), +(itemSubtotal + itemGst).toFixed(2)]);

            if (item.product_id) {
              // Automatic Stock Adjustment (restock)
              await dbRun(`
                UPDATE products 
                SET current_stock = current_stock + $1, available_stock = available_stock + $1 
                WHERE id = $2
              `, [returnQty, item.product_id]);

              // Log stock movement
              await dbRun(`
                INSERT INTO stock_transactions (product_id, transaction_type, quantity, reference_id, notes)
                VALUES ($1, 'Return', $2, $3, $4)
              `, [item.product_id, returnQty, nextRetNo, `Sales Return against ${invoice.invoice_number}`]);
            }
          }
        }

        // 3. Deduct from customer's outstanding balance if invoice was unpaid
        if (invoice.status === 'unpaid' && invoice.customer_id) {
          await dbRun(`
            UPDATE customers 
            SET outstanding_balance = MAX(0, outstanding_balance - $1) 
            WHERE id = $2
          `, [returnTotals.total, invoice.customer_id]);
        }
      }

      alert(`✅ Sales Return ${nextRetNo} generated successfully! Stocks adjusted and taxes recalculated.`);
      setInvoice(null);
      setInvoiceItems([]);
      setSearchInvoiceNo('');
      setActiveTab('history');
    } catch (err: any) {
      alert(`Failed to save sales return: ${err.message || err}`);
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
          🔄 Issue Sales Return
        </button>
        <button 
          className={`btn ${activeTab === 'history' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setActiveTab('history')}
        >
          📚 Return Ledger History
        </button>
      </div>

      {activeTab === 'create' && (
        <>
          <div className="section-header">
            <h3>Record Sales Return & Credit Note</h3>
          </div>

          {/* Search bar */}
          <div className="card" style={{ marginBottom: '20px', padding: '18px 24px' }}>
            <form onSubmit={handleLookupInvoice} style={{ display: 'flex', gap: '12px', alignItems: 'end' }}>
              <div className="form-group" style={{ flex: 1 }}>
                <label>Enter Sales Invoice Number</label>
                <input 
                  type="text" 
                  required
                  placeholder="e.g. INV-0001" 
                  value={searchInvoiceNo}
                  onChange={e => setSearchInvoiceNo(e.target.value)}
                />
              </div>
              <button type="submit" className="btn btn-primary" style={{ padding: '11px 24px' }}>
                🔍 Lookup Invoice
              </button>
            </form>
          </div>

          {/* Return Workspace */}
          {invoice ? (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: '24px', alignItems: 'start' }}>
              <div>
                {/* Invoice details summary */}
                <div className="card" style={{ marginBottom: '16px', padding: '16px 20px' }}>
                  <h4 style={{ fontSize: '14px', fontWeight: 700, marginBottom: '10px' }}>Original Sale Info</h4>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px', fontSize: '13px' }}>
                    <div>Customer: <strong>{invoice.customer_name}</strong></div>
                    <div>Sale Date: <strong>{invoice.date}</strong></div>
                    <div>Status: <span className={`badge ${invoice.status === 'paid' ? 'badge-green' : 'badge-red'}`}>{invoice.status}</span></div>
                  </div>
                </div>

                {/* Items loop */}
                <div className="card" style={{ padding: '24px 0 0 0' }}>
                  <h4 style={{ fontSize: '14px', fontWeight: 700, margin: '0 24px 12px 24px' }}>Invoice Line Items for Return</h4>
                  <div style={{ padding: '0 16px' }}>
                    {invoiceItems.map((item) => {
                      const maxReturnable = item.quantity - item.returned_qty;
                      return (
                        <div key={item.id} style={{ background: 'var(--light)', padding: '14px', borderRadius: '10px', margin: '8px 0', border: '1px solid #f1f5f9' }}>
                          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1.2fr 1.2fr', gap: '10px', alignItems: 'center' }}>
                            <div>
                              <strong style={{ fontSize: '13px' }}>{item.name}</strong>
                              <div style={{ fontSize: '11px', color: 'var(--gray)', marginTop: '2px' }}>
                                Purchased: {item.quantity} | Returned: {item.returned_qty}
                              </div>
                            </div>
                            <div style={{ fontSize: '13px' }}>
                              Price: <strong>{fmtCurrency(item.price)}</strong>
                            </div>
                            <div style={{ fontSize: '13px' }}>
                              GST: <strong>{item.gst_percentage}%</strong>
                            </div>
                            <div className="form-group" style={{ marginBottom: 0 }}>
                              <label style={{ fontSize: '10px' }}>Return Qty</label>
                              <input 
                                type="number" 
                                min="0" 
                                max={maxReturnable}
                                disabled={maxReturnable <= 0}
                                value={returnQuantities[item.id] || 0}
                                onChange={e => handleQtyChange(item.id, maxReturnable, e.target.value)}
                                style={{ padding: '6px 8px' }}
                              />
                            </div>
                            <div style={{ textAlign: 'right', fontWeight: 700, color: 'var(--red)' }}>
                              {fmtCurrency((item.price * (1 + item.gst_percentage / 100)) * (returnQuantities[item.id] || 0))}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Summary and notes */}
              <div>
                <div className="card">
                  <h4 style={{ fontSize: '15px', fontWeight: 700, marginBottom: '16px' }}>Return Credit Note Summary</h4>
                  
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '20px', borderBottom: '1px solid var(--border)', paddingBottom: '16px', fontSize: '13px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--gray)' }}>Taxable Subtotal</span>
                      <strong>{fmtCurrency(returnTotals.subtotal)}</strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--gray)' }}>GST Refund Amount</span>
                      <strong>{fmtCurrency(returnTotals.gst_amount)}</strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '16px', borderTop: '1px solid var(--border)', paddingTop: '12px' }}>
                      <span style={{ fontWeight: 700 }}>Total Credit Refund</span>
                      <strong style={{ color: 'var(--red)' }}>{fmtCurrency(returnTotals.total)}</strong>
                    </div>
                  </div>

                  <div className="form-group" style={{ marginBottom: '20px' }}>
                    <label>Reason for Return / Notes</label>
                    <textarea 
                      value={returnNotes} 
                      rows={3} 
                      onChange={e => setReturnNotes(e.target.value)} 
                      placeholder="e.g. Defective model, customer exchange..."
                    />
                  </div>

                  <button 
                    className="btn btn-danger" 
                    style={{ width: '100%', justifyContent: 'center', padding: '12px', fontSize: '14px' }}
                    onClick={handleSubmitReturn}
                  >
                    ↩️ Issue Sales Return Credit
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '360px', color: 'var(--gray)' }}>
              Enter a valid invoice number to retrieve records, calculate partial/full returns, restock inventory, and refund balances.
            </div>
          )}
        </>
      )}

      {activeTab === 'history' && (
        <>
          <div className="section-header">
            <h3>Sales Return Credit Notes History</h3>
          </div>

          <div className="card" style={{ padding: 0 }}>
            {historyLoading ? (
              <p style={{ padding: '24px', textAlign: 'center' }}>Loading history...</p>
            ) : returnHistory.length === 0 ? (
              <p style={{ padding: '24px', textAlign: 'center', color: 'var(--gray)' }}>No sales returns recorded yet.</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Return Credit#</th>
                      <th>Return Date</th>
                      <th>Original Invoice#</th>
                      <th>Customer Name</th>
                      <th>Taxable refunded</th>
                      <th>GST refunded</th>
                      <th>Total Credit Ref</th>
                      <th>Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {returnHistory.map(row => (
                      <tr key={row.id}>
                        <td style={{ fontWeight: 700, color: 'var(--red)' }}>{row.return_number}</td>
                        <td>{row.return_date}</td>
                        <td><code style={{ fontWeight: 600 }}>{row.invoice_number}</code></td>
                        <td>{row.customer_name}</td>
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
