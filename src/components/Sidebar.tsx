'use client';

import React, { useState, useEffect } from 'react';
import { dbQuery } from '@/lib/api';

export interface NavItem {
  id: string;
  icon: string;
  label: string;
}

interface SidebarProps {
  activePage: string;
  setActivePage: (page: string) => void;
  role?: string;
}

export default function Sidebar({ activePage, setActivePage, role = 'Admin' }: SidebarProps) {
  const [businessName, setBusinessName] = useState("JIYA'S ARCADE");

  useEffect(() => {
    loadBusinessName();
  }, []);

  const loadBusinessName = async () => {
    try {
      const res = await dbQuery('SELECT name FROM business_profile WHERE id = 1');
      if (res && res.length > 0 && res[0].name) {
        setBusinessName(res[0].name);
      }
    } catch (err) {
      console.error('Failed to load business name for sidebar logo:', err);
    }
  };

  const NAV: NavItem[] = [
    { id: 'dashboard', icon: '📊', label: 'Dashboard' },
    { id: 'invoices', icon: '🧾', label: 'Invoices' },
    { id: 'billing', icon: '➕', label: 'New Invoice' },
    { id: 'inventory', icon: '📦', label: 'Inventory' },
    { id: 'customers', icon: '👥', label: 'Customers' },
    { id: 'suppliers', icon: '🏭', label: 'Suppliers' },
    { id: 'ledger', icon: '📖', label: 'Customer Ledger' },
    { id: 'sales-return', icon: '↩️', label: 'Sales Returns' },
    { id: 'purchase-return', icon: '🔁', label: 'Purchase Returns' },
    { id: 'reports', icon: '📈', label: 'Reports' },
    { id: 'finance-partners', icon: '🤝', label: 'Finance Partners' },
    { id: 'settings', icon: '⚙️', label: 'Settings' },
  ];

  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <h1>SARAL</h1>
        <p>Billing & Inventory Suite</p>
      </div>
      
      <div className="nav-section">Navigation</div>
      
      {NAV.map((n) => (
        <div
          key={n.id}
          className={`nav-item ${activePage === n.id ? 'active' : ''}`}
          onClick={() => setActivePage(n.id)}
        >
          <span className="nav-icon">{n.icon}</span>
          {n.label}
        </div>
      ))}
      
      <div style={{ marginTop: 'auto', padding: '20px 16px', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
        <p style={{ fontSize: '11px', color: '#94a3b8', fontWeight: 600 }}>{businessName}</p>
        <p style={{ fontSize: '10px', color: '#64748b', marginTop: '2px' }}>Role: {role} · Offline Mode</p>
      </div>
    </aside>
  );
}
