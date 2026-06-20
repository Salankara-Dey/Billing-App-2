'use client';

import React, { useState, useEffect } from 'react';
import { dbQuery } from '@/lib/api';

interface SalesAggregate {
  date: string;
  revenue: number;
  count: number;
}

interface StockValuation {
  category: string;
  count: number;
  total_qty: number;
  purchase_value: number;
  sales_value: number;
}

interface DeadStock {
  name: string;
  category: string;
  current_stock: number;
  purchase_price: number;
  valuation: number;
}

interface FastItem {
  name: string;
  category: string;
  qty: number;
  total_val: number;
}

export default function ReportsView() {
  const [activeTab, setActiveTab] = useState<'sales' | 'inventory' | 'finance'>('sales');
  const [loading, setLoading] = useState(true);

  // Sales State
  const [salesDaily, setSalesDaily] = useState<SalesAggregate[]>([]);
  
  // Inventory State
  const [valuations, setValuations] = useState<StockValuation[]>([]);
  const [deadStock, setDeadStock] = useState<DeadStock[]>([]);
  const [fastMoving, setFastMoving] = useState<FastItem[]>([]);

  // Finance State
  const [finance, setFinance] = useState({
    revenue: 0,
    cogs: 0,
    grossProfit: 0,
    margins: 0,
    receivables: 0,
    payables: 0
  });

  useEffect(() => {
    loadReports();
  }, [activeTab]);

  const loadReports = async () => {
    setLoading(true);
    try {
      if (activeTab === 'sales') {
        const res = await dbQuery(`
          SELECT date, SUM(total) as revenue, COUNT(*) as count 
          FROM invoices 
          WHERE status = 'paid' 
          GROUP BY date 
          ORDER BY date DESC LIMIT 30
        `);
        setSalesDaily(res);
      } 
      
      else if (activeTab === 'inventory') {
        // Stock valuation grouped by category
        const valRes = await dbQuery(`
          SELECT category, COUNT(*) as count, SUM(current_stock) as total_qty,
                 SUM(current_stock * purchase_price) as purchase_value,
                 SUM(current_stock * selling_price) as sales_value
          FROM products
          GROUP BY category
        `);
        setValuations(valRes);

        // Dead stock (products with stock > 0 but NO sales in registry)
        const deadRes = await dbQuery(`
          SELECT p.name, p.category, p.current_stock, p.purchase_price,
                 (p.current_stock * p.purchase_price) as valuation
          FROM products p
          LEFT JOIN invoice_items ii ON p.id = ii.product_id
          WHERE ii.product_id IS NULL AND p.current_stock > 0
          ORDER BY valuation DESC LIMIT 20
        `);
        setDeadStock(deadRes);

        // Fast moving
        const fastRes = await dbQuery(`
          SELECT p.name, p.category, SUM(ii.quantity) as qty, SUM(ii.total) as total_val
          FROM invoice_items ii
          JOIN products p ON ii.product_id = p.id
          GROUP BY ii.product_id
          ORDER BY qty DESC LIMIT 10
        `);
        setFastMoving(fastRes);
      } 
      
      else if (activeTab === 'finance') {
        // Revenue (paid invoices total)
        const revRes = await dbQuery("SELECT SUM(total) as total FROM invoices WHERE status = 'paid'");
        const revenue = revRes[0]?.total || 0;

        // Cost of Goods Sold (COGS)
        const cogsRes = await dbQuery(`
          SELECT SUM(ii.quantity * p.purchase_price) as total_cogs 
          FROM invoice_items ii 
          JOIN products p ON ii.product_id = p.id
          JOIN invoices i ON ii.invoice_id = i.id
          WHERE i.status = 'paid'
        `);
        const cogs = cogsRes[0]?.total_cogs || 0;

        // Receivables (unpaid invoices total)
        const recRes = await dbQuery("SELECT SUM(total) as total FROM invoices WHERE status = 'unpaid'");
        const receivables = recRes[0]?.total || 0;

        // Payables (outstanding supplier balances)
        const payRes = await dbQuery("SELECT SUM(outstanding_balance) as total FROM suppliers");
        const payables = payRes[0]?.total || 0;

        const grossProfit = revenue - cogs;
        const margins = revenue > 0 ? (grossProfit / revenue) * 100 : 0;

        setFinance({
          revenue, cogs, grossProfit, margins, receivables, payables
        });
      }
    } catch (err) {
      console.error('Failed to generate report parameters:', err);
    } finally {
      setLoading(false);
    }
  };

  const fmtCurrency = (n: number) => {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);
  };

  return (
    <div>
      {/* Navigation tabs */}
      <div style={{ display: 'flex', gap: '10px', marginBottom: '20px', borderBottom: '1px solid var(--border)', paddingBottom: '10px' }}>
        <button 
          className={`btn ${activeTab === 'sales' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setActiveTab('sales')}
        >
          📈 Sales Ledger
        </button>
        <button 
          className={`btn ${activeTab === 'inventory' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setActiveTab('inventory')}
        >
          📦 Stock valuation
        </button>
        <button 
          className={`btn ${activeTab === 'finance' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setActiveTab('finance')}
        >
          💼 Profit & Loss Sheet
        </button>
      </div>

      {loading ? (
        <div style={{ padding: '40px', textAlign: 'center' }}>Compiling ledger statistics...</div>
      ) : (
        <>
          {activeTab === 'sales' && (
            <>
              <div className="section-header">
                <h3>Daily Sales Revenue Chart</h3>
              </div>
              <div className="card" style={{ padding: 0 }}>
                {salesDaily.length === 0 ? (
                  <p style={{ padding: '24px', textAlign: 'center', color: 'var(--gray)' }}>No transaction records to display.</p>
                ) : (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Billing Date</th>
                          <th>Invoices Count</th>
                          <th style={{ textAlign: 'right' }}>Total Revenue Collected</th>
                        </tr>
                      </thead>
                      <tbody>
                        {salesDaily.map((row, i) => (
                          <tr key={i}>
                            <td style={{ fontWeight: 600 }}>{row.date}</td>
                            <td>{row.count} invoices issued</td>
                            <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--green)' }}>
                              {fmtCurrency(row.revenue)}
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

          {activeTab === 'inventory' && (
            <>
              {/* Stock Valuation Summary */}
              <div className="section-header">
                <h3>Stock Valuation by Category</h3>
              </div>
              <div className="card" style={{ padding: 0, marginBottom: '24px' }}>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Category</th>
                        <th>Unique Items</th>
                        <th>Total Stock Quantity</th>
                        <th>Asset Value (Buy Price)</th>
                        <th>Estimated Sales Value (Sell Price)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {valuations.map((row, i) => (
                        <tr key={i}>
                          <td style={{ fontWeight: 600 }}>{row.category}</td>
                          <td>{row.count} models</td>
                          <td>{row.total_qty || 0} units</td>
                          <td style={{ fontWeight: 700, color: 'var(--dark)' }}>{fmtCurrency(row.purchase_value || 0)}</td>
                          <td style={{ fontWeight: 700, color: 'var(--brand)' }}>{fmtCurrency(row.sales_value || 0)}</td>
                        </tr>
                      ))}
                      {/* Grand total */}
                      <tr style={{ background: '#f8fafc', fontWeight: 700 }}>
                        <td>Grand Total</td>
                        <td>{valuations.reduce((s,r)=>s+r.count, 0)} items</td>
                        <td>{valuations.reduce((s,r)=>s+(r.total_qty||0), 0)} units</td>
                        <td style={{ color: 'var(--green)' }}>
                          {fmtCurrency(valuations.reduce((s,r)=>s+(r.purchase_value||0), 0))}
                        </td>
                        <td style={{ color: 'var(--brand)' }}>
                          {fmtCurrency(valuations.reduce((s,r)=>s+(r.sales_value||0), 0))}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Grid for Dead Stock vs Fast Stock */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '20px' }}>
                {/* Dead Stock */}
                <div className="card" style={{ padding: 0 }}>
                  <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
                    <h4 style={{ fontSize: '14px', fontWeight: 700 }}>Dead Stock Aging (No Sales Record)</h4>
                  </div>
                  <div className="table-wrap" style={{ border: 'none' }}>
                    <table>
                      <thead>
                        <tr>
                          <th>Item</th>
                          <th>Stock</th>
                          <th style={{ textAlign: 'right' }}>Valuation</th>
                        </tr>
                      </thead>
                      <tbody>
                        {deadStock.length === 0 ? (
                          <tr><td colSpan={3} style={{ textAlign: 'center', color: 'var(--gray)' }}>No dead stock detected.</td></tr>
                        ) : deadStock.map((row, i) => (
                          <tr key={i}>
                            <td style={{ fontWeight: 600 }}>{row.name}</td>
                            <td>{row.current_stock} units</td>
                            <td style={{ textAlign: 'right', fontWeight: 600 }}>{fmtCurrency(row.valuation)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Fast Moving */}
                <div className="card" style={{ padding: 0 }}>
                  <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
                    <h4 style={{ fontSize: '14px', fontWeight: 700 }}>Top Revenue Generating Items</h4>
                  </div>
                  <div className="table-wrap" style={{ border: 'none' }}>
                    <table>
                      <thead>
                        <tr>
                          <th>Item</th>
                          <th>Units Sold</th>
                          <th style={{ textAlign: 'right' }}>Revenue Generated</th>
                        </tr>
                      </thead>
                      <tbody>
                        {fastMoving.length === 0 ? (
                          <tr><td colSpan={3} style={{ textAlign: 'center', color: 'var(--gray)' }}>No sales recorded.</td></tr>
                        ) : fastMoving.map((row, i) => (
                          <tr key={i}>
                            <td style={{ fontWeight: 600 }}>{row.name}</td>
                            <td>{row.qty} sold</td>
                            <td style={{ textAlign: 'right', fontWeight: 600, color: 'var(--green)' }}>{fmtCurrency(row.total_val)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </>
          )}

          {activeTab === 'finance' && (
            <>
              <div className="section-header">
                <h3>Profit & Loss Statement (Cash Basis)</h3>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '20px', marginBottom: '24px' }}>
                <div className="stat-card green">
                  <div className="label">Total Sales Revenue</div>
                  <div className="value">{fmtCurrency(finance.revenue)}</div>
                  <div className="sub">Cash collected from paid bills</div>
                </div>
                <div className="stat-card red">
                  <div className="label">Cost of Goods Sold (COGS)</div>
                  <div className="value">{fmtCurrency(finance.cogs)}</div>
                  <div className="sub">Asset purchase value of items sold</div>
                </div>
                <div className="stat-card orange">
                  <div className="label">Gross profit Margin</div>
                  <div className="value">{fmtCurrency(finance.grossProfit)}</div>
                  <div className="sub">Margin: {finance.margins.toFixed(1)}% MoM</div>
                </div>
              </div>

              {/* Balance Sheet outstanding summary */}
              <div className="card" style={{ padding: '20px 24px' }}>
                <h4 style={{ fontSize: '14px', fontWeight: 700, marginBottom: '14px' }}>Receivables vs Payables Outlook</h4>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                  <div style={{ background: '#fff5f5', border: '1px solid #feb2b2', borderRadius: '8px', padding: '16px' }}>
                    <div style={{ fontSize: '12px', color: '#c53030', fontWeight: 700, textTransform: 'uppercase' }}>Supplier outstanding payables</div>
                    <div style={{ fontSize: '24px', fontWeight: 800, marginTop: '6px', color: '#9b2c2c' }}>{fmtCurrency(finance.payables)}</div>
                    <p style={{ fontSize: '11px', color: '#9b2c2c', marginTop: '4px' }}>Outstanding dues payable to vendors</p>
                  </div>
                  <div style={{ background: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: '8px', padding: '16px' }}>
                    <div style={{ fontSize: '12px', color: '#065f46', fontWeight: 700, textTransform: 'uppercase' }}>Customer outstanding receivables</div>
                    <div style={{ fontSize: '24px', fontWeight: 800, marginTop: '6px', color: '#064e3b' }}>{fmtCurrency(finance.receivables)}</div>
                    <p style={{ fontSize: '11px', color: '#064e3b', marginTop: '4px' }}>Credit sales awaiting customer settlements</p>
                  </div>
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
