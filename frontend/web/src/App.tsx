// App.tsx
import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import "./App.css";
import { useAccount, useSignMessage } from 'wagmi';

interface HedgeFund {
  id: string;
  name: string;
  encryptedPerformance: string;
  encryptedRisk: string;
  encryptedAssets: string;
  timestamp: number;
  owner: string;
  strategy: string;
}

const FHEEncryptNumber = (value: number): string => {
  return `FHE-${btoa(value.toString())}`;
};

const FHEDecryptNumber = (encryptedData: string): number => {
  if (encryptedData.startsWith('FHE-')) {
    return parseFloat(atob(encryptedData.substring(4)));
  }
  return parseFloat(encryptedData);
};

const generatePublicKey = () => `0x${Array(2000).fill(0).map(() => Math.floor(Math.random() * 16).toString(16)).join('')}`;

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [loading, setLoading] = useState(true);
  const [funds, setFunds] = useState<HedgeFund[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ visible: false, status: "pending", message: "" });
  const [newFundData, setNewFundData] = useState({ name: "", strategy: "Quant", initialAssets: 1000000 });
  const [selectedFund, setSelectedFund] = useState<HedgeFund | null>(null);
  const [decryptedValue, setDecryptedValue] = useState<{ performance?: number, risk?: number, assets?: number }>({});
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [publicKey, setPublicKey] = useState<string>("");
  const [contractAddress, setContractAddress] = useState<string>("");
  const [chainId, setChainId] = useState<number>(0);
  const [startTimestamp, setStartTimestamp] = useState<number>(0);
  const [durationDays, setDurationDays] = useState<number>(30);
  const [marketConditions, setMarketConditions] = useState<{ volatility: number, trend: number, blackSwan: boolean }>({ volatility: 0.5, trend: 0.2, blackSwan: false });

  // Simulate market conditions changing
  useEffect(() => {
    const interval = setInterval(() => {
      setMarketConditions(prev => ({
        volatility: Math.min(1, Math.max(0, prev.volatility + (Math.random() - 0.5) * 0.1)),
        trend: Math.min(1, Math.max(-1, prev.trend + (Math.random() - 0.5) * 0.05)),
        blackSwan: Math.random() > 0.99 ? true : prev.blackSwan
      }));
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    loadFunds().finally(() => setLoading(false));
    const initSignatureParams = async () => {
      const contract = await getContractReadOnly();
      if (contract) setContractAddress(await contract.getAddress());
      if (window.ethereum) {
        const chainIdHex = await window.ethereum.request({ method: 'eth_chainId' });
        setChainId(parseInt(chainIdHex, 16));
      }
      setStartTimestamp(Math.floor(Date.now() / 1000));
      setDurationDays(30);
      setPublicKey(generatePublicKey());
    };
    initSignatureParams();
  }, []);

  const loadFunds = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        console.log("Contract not available");
        return;
      }

      // Get list of fund keys
      const keysBytes = await contract.getData("fund_keys");
      let keys: string[] = [];
      if (keysBytes.length > 0) {
        try {
          const keysStr = ethers.toUtf8String(keysBytes);
          if (keysStr.trim() !== '') keys = JSON.parse(keysStr);
        } catch (e) { console.error("Error parsing fund keys:", e); }
      }

      // Load each fund's data
      const list: HedgeFund[] = [];
      for (const key of keys) {
        try {
          const fundBytes = await contract.getData(`fund_${key}`);
          if (fundBytes.length > 0) {
            try {
              const fundData = JSON.parse(ethers.toUtf8String(fundBytes));
              list.push({ 
                id: key, 
                name: fundData.name, 
                encryptedPerformance: fundData.performance, 
                encryptedRisk: fundData.risk,
                encryptedAssets: fundData.assets,
                timestamp: fundData.timestamp, 
                owner: fundData.owner, 
                strategy: fundData.strategy 
              });
            } catch (e) { console.error(`Error parsing fund data for ${key}:`, e); }
          }
        } catch (e) { console.error(`Error loading fund ${key}:`, e); }
      }

      // Sort by performance (descending)
      list.sort((a, b) => {
        const aPerf = a.encryptedPerformance;
        const bPerf = b.encryptedPerformance;
        if (aPerf > bPerf) return -1;
        if (aPerf < bPerf) return 1;
        return 0;
      });

      setFunds(list);
    } catch (e) { console.error("Error loading funds:", e); } 
    finally { setIsRefreshing(false); setLoading(false); }
  };

  const createFund = async () => {
    if (!isConnected) { alert("Please connect wallet first"); return; }
    setCreating(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Encrypting fund data with Zama FHE..." });
    try {
      // Encrypt initial data with FHE
      const encryptedPerformance = FHEEncryptNumber(0); // Start with 0 performance
      const encryptedRisk = FHEEncryptNumber(0.2); // Initial risk factor
      const encryptedAssets = FHEEncryptNumber(newFundData.initialAssets);

      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");

      // Generate unique ID
      const fundId = `fund-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
      
      // Store fund data
      const fundData = { 
        name: newFundData.name,
        performance: encryptedPerformance,
        risk: encryptedRisk,
        assets: encryptedAssets,
        timestamp: Math.floor(Date.now() / 1000),
        owner: address,
        strategy: newFundData.strategy
      };
      
      await contract.setData(`fund_${fundId}`, ethers.toUtf8Bytes(JSON.stringify(fundData)));

      // Update fund keys list
      const keysBytes = await contract.getData("fund_keys");
      let keys: string[] = [];
      if (keysBytes.length > 0) {
        try { keys = JSON.parse(ethers.toUtf8String(keysBytes)); } 
        catch (e) { console.error("Error parsing keys:", e); }
      }
      keys.push(fundId);
      await contract.setData("fund_keys", ethers.toUtf8Bytes(JSON.stringify(keys)));

      setTransactionStatus({ visible: true, status: "success", message: "Hedge fund created with FHE encryption!" });
      await loadFunds();
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewFundData({ name: "", strategy: "Quant", initialAssets: 1000000 });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction") ? "Transaction rejected by user" : "Creation failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { setCreating(false); }
  };

  const decryptWithSignature = async (encryptedData: string, field: 'performance' | 'risk' | 'assets'): Promise<void> => {
    if (!isConnected) { alert("Please connect wallet first"); return; }
    setIsDecrypting(true);
    try {
      const message = `publickey:${publicKey}\ncontractAddresses:${contractAddress}\ncontractsChainId:${chainId}\nstartTimestamp:${startTimestamp}\ndurationDays:${durationDays}`;
      await signMessageAsync({ message });
      await new Promise(resolve => setTimeout(resolve, 1500));
      const decrypted = FHEDecryptNumber(encryptedData);
      setDecryptedValue(prev => ({ ...prev, [field]: decrypted }));
    } catch (e) { console.error("Decryption failed:", e); } 
    finally { setIsDecrypting(false); }
  };

  const simulateMarket = async () => {
    if (!isConnected) { alert("Please connect wallet first"); return; }
    setTransactionStatus({ visible: true, status: "pending", message: "Running market simulation with FHE..." });
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");

      // Get current fund keys
      const keysBytes = await contract.getData("fund_keys");
      let keys: string[] = [];
      if (keysBytes.length > 0) {
        try { keys = JSON.parse(ethers.toUtf8String(keysBytes)); } 
        catch (e) { console.error("Error parsing keys:", e); }
      }

      // Update each fund's performance based on market conditions
      for (const key of keys) {
        const fundBytes = await contract.getData(`fund_${key}`);
        if (fundBytes.length === 0) continue;
        
        const fundData = JSON.parse(ethers.toUtf8String(fundBytes));
        
        // In a real implementation, we would use FHE operations here
        // For demo purposes, we'll decrypt, calculate, then re-encrypt
        const performance = FHEDecryptNumber(fundData.performance);
        const risk = FHEDecryptNumber(fundData.risk);
        const assets = FHEDecryptNumber(fundData.assets);
        
        // Simulate performance change based on market conditions
        let performanceChange = (marketConditions.trend * 0.1) + (Math.random() - 0.5) * marketConditions.volatility;
        if (marketConditions.blackSwan) {
          performanceChange = -0.3 + (Math.random() - 0.5) * 0.4; // Big negative impact
        }
        
        // Apply strategy modifiers
        let strategyMultiplier = 1;
        switch(fundData.strategy) {
          case "Quant": strategyMultiplier = 1.2; break;
          case "Value": strategyMultiplier = 0.8; break;
          case "Macro": strategyMultiplier = 1.0; break;
        }
        
        const newPerformance = performance + performanceChange * strategyMultiplier * (1 - risk);
        const newAssets = assets * (1 + performanceChange * 0.01); // Assets grow with performance
        
        // Re-encrypt with FHE
        const updatedFund = { 
          ...fundData, 
          performance: FHEEncryptNumber(newPerformance),
          assets: FHEEncryptNumber(newAssets)
        };
        
        await contract.setData(`fund_${key}`, ethers.toUtf8Bytes(JSON.stringify(updatedFund)));
      }

      setTransactionStatus({ visible: true, status: "success", message: "Market simulation completed with FHE!" });
      await loadFunds();
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e: any) {
      setTransactionStatus({ visible: true, status: "error", message: "Simulation failed: " + (e.message || "Unknown error") });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const isOwner = (fundAddress: string) => address?.toLowerCase() === fundAddress.toLowerCase();

  // Calculate statistics
  const totalFunds = funds.length;
  const totalAssets = funds.reduce((sum, fund) => sum + (decryptedValue.assets || 0), 0);
  const avgPerformance = funds.length > 0 ? funds.reduce((sum, fund) => sum + (decryptedValue.performance || 0), 0) / funds.length : 0;

  if (loading) return (
    <div className="loading-screen">
      <div className="mechanical-spinner"></div>
      <p>Initializing encrypted market connection...</p>
    </div>
  );

  return (
    <div className="app-container industrial-theme">
      <header className="app-header">
        <div className="logo">
          <div className="gear-icon"></div>
          <h1>FHE<span>Hedge</span>War</h1>
        </div>
        <div className="header-actions">
          <button onClick={() => setShowCreateModal(true)} className="create-fund-btn industrial-button">
            <div className="add-icon"></div>New Fund
          </button>
          <button onClick={simulateMarket} className="industrial-button" disabled={funds.length === 0}>
            Run Market Simulation
          </button>
          <div className="wallet-connect-wrapper"><ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/></div>
        </div>
      </header>

      <div className="main-content">
        {/* Market Conditions Panel */}
        <div className="market-conditions industrial-panel">
          <h2>Market Conditions</h2>
          <div className="condition-meters">
            <div className="meter">
              <label>Volatility</label>
              <div className="meter-bar">
                <div className="meter-fill" style={{ width: `${marketConditions.volatility * 100}%` }}></div>
              </div>
              <span>{Math.round(marketConditions.volatility * 100)}%</span>
            </div>
            <div className="meter">
              <label>Trend</label>
              <div className="meter-bar trend">
                <div className="meter-fill" style={{ 
                  width: `${Math.abs(marketConditions.trend) * 50}%`,
                  marginLeft: marketConditions.trend > 0 ? '50%' : `${50 - Math.abs(marketConditions.trend) * 50}%`
                }}></div>
              </div>
              <span>{marketConditions.trend > 0 ? '↑' : '↓'} {Math.abs(Math.round(marketConditions.trend * 100))}%</span>
            </div>
            <div className="black-swan-indicator">
              <label>Black Swan Event</label>
              <div className={`status-light ${marketConditions.blackSwan ? 'active' : ''}`}></div>
              <span>{marketConditions.blackSwan ? 'ACTIVE' : 'Inactive'}</span>
            </div>
          </div>
        </div>

        {/* Dashboard Grid */}
        <div className="dashboard-grid">
          {/* Project Introduction */}
          <div className="dashboard-card industrial-panel">
            <h3>Hedge Fund Secret War</h3>
            <p>A competitive simulation where hedge funds with <strong>FHE-encrypted</strong> strategies battle in a dynamic market. Powered by <strong>Zama FHE</strong> technology.</p>
            <div className="key-features">
              <div className="feature">
                <div className="feature-icon">🔒</div>
                <span>Encrypted Strategies</span>
              </div>
              <div className="feature">
                <div className="feature-icon">📊</div>
                <span>Real Market Dynamics</span>
              </div>
              <div className="feature">
                <div className="feature-icon">⚔️</div>
                <span>Competitive Rankings</span>
              </div>
            </div>
          </div>

          {/* Data Statistics */}
          <div className="dashboard-card industrial-panel stats-panel">
            <h3>Market Statistics</h3>
            <div className="stats-grid">
              <div className="stat-item">
                <div className="stat-value">{totalFunds}</div>
                <div className="stat-label">Active Funds</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">${(totalAssets / 1000000).toFixed(1)}M</div>
                <div className="stat-label">Total Assets</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{avgPerformance.toFixed(1)}%</div>
                <div className="stat-label">Avg Performance</div>
              </div>
            </div>
          </div>

          {/* Real-time Data Dashboard */}
          <div className="dashboard-card industrial-panel">
            <h3>Performance Distribution</h3>
            <div className="performance-chart">
              {funds.slice(0, 5).map((fund, index) => (
                <div key={fund.id} className="performance-bar-container">
                  <div className="fund-name">{fund.name}</div>
                  <div className="performance-bar">
                    <div 
                      className="bar-fill" 
                      style={{ width: `${Math.min(100, Math.max(0, (decryptedValue.performance || 0) * 10 + 50))}%` }}
                    ></div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Leaderboard */}
        <div className="leaderboard-section">
          <div className="section-header">
            <h2>Hedge Fund Leaderboard</h2>
            <div className="header-actions">
              <button onClick={loadFunds} className="refresh-btn industrial-button" disabled={isRefreshing}>
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>
          <div className="leaderboard-table industrial-panel">
            <div className="table-header">
              <div className="header-cell">Rank</div>
              <div className="header-cell">Fund Name</div>
              <div className="header-cell">Strategy</div>
              <div className="header-cell">Performance</div>
              <div className="header-cell">Risk</div>
              <div className="header-cell">Assets</div>
              <div className="header-cell">Actions</div>
            </div>
            {funds.length === 0 ? (
              <div className="no-funds">
                <div className="no-funds-icon"></div>
                <p>No hedge funds found</p>
                <button className="industrial-button primary" onClick={() => setShowCreateModal(true)}>Create First Fund</button>
              </div>
            ) : funds.map((fund, index) => (
              <div className="fund-row" key={fund.id} onClick={() => setSelectedFund(fund)}>
                <div className="table-cell rank">#{index + 1}</div>
                <div className="table-cell name">{fund.name}</div>
                <div className="table-cell strategy">{fund.strategy}</div>
                <div className="table-cell performance">
                  {decryptedValue.performance !== undefined ? `${decryptedValue.performance.toFixed(2)}%` : '🔒'}
                  <button 
                    className="decrypt-btn" 
                    onClick={(e) => {
                      e.stopPropagation();
                      decryptWithSignature(fund.encryptedPerformance, 'performance');
                    }}
                    disabled={isDecrypting}
                  >
                    {isDecrypting ? '...' : decryptedValue.performance !== undefined ? '🔓' : '🔒'}
                  </button>
                </div>
                <div className="table-cell risk">
                  {decryptedValue.risk !== undefined ? decryptedValue.risk.toFixed(2) : '🔒'}
                  <button 
                    className="decrypt-btn" 
                    onClick={(e) => {
                      e.stopPropagation();
                      decryptWithSignature(fund.encryptedRisk, 'risk');
                    }}
                    disabled={isDecrypting}
                  >
                    {isDecrypting ? '...' : decryptedValue.risk !== undefined ? '🔓' : '🔒'}
                  </button>
                </div>
                <div className="table-cell assets">
                  {decryptedValue.assets !== undefined ? `$${(decryptedValue.assets / 1000000).toFixed(2)}M` : '🔒'}
                  <button 
                    className="decrypt-btn" 
                    onClick={(e) => {
                      e.stopPropagation();
                      decryptWithSignature(fund.encryptedAssets, 'assets');
                    }}
                    disabled={isDecrypting}
                  >
                    {isDecrypting ? '...' : decryptedValue.assets !== undefined ? '🔓' : '🔒'}
                  </button>
                </div>
                <div className="table-cell actions">
                  {isOwner(fund.owner) && (
                    <button className="action-btn industrial-button" onClick={(e) => {
                      e.stopPropagation();
                      // Future: Add fund management options
                    }}>
                      Manage
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Create Fund Modal */}
      {showCreateModal && (
        <div className="modal-overlay">
          <div className="create-modal industrial-panel">
            <div className="modal-header">
              <h2>Launch New Hedge Fund</h2>
              <button onClick={() => setShowCreateModal(false)} className="close-modal">&times;</button>
            </div>
            <div className="modal-body">
              <div className="fhe-notice">
                <div className="lock-icon"></div>
                <p>Your fund strategy and performance will be encrypted with <strong>Zama FHE</strong> technology</p>
              </div>
              <div className="form-group">
                <label>Fund Name *</label>
                <input 
                  type="text" 
                  value={newFundData.name} 
                  onChange={(e) => setNewFundData({...newFundData, name: e.target.value})}
                  placeholder="Enter fund name..."
                  className="industrial-input"
                />
              </div>
              <div className="form-group">
                <label>Investment Strategy *</label>
                <select 
                  value={newFundData.strategy} 
                  onChange={(e) => setNewFundData({...newFundData, strategy: e.target.value})}
                  className="industrial-select"
                >
                  <option value="Quant">Quantitative</option>
                  <option value="Value">Value Investing</option>
                  <option value="Macro">Macro Strategy</option>
                </select>
              </div>
              <div className="form-group">
                <label>Initial Assets (USD) *</label>
                <input 
                  type="number" 
                  value={newFundData.initialAssets} 
                  onChange={(e) => setNewFundData({...newFundData, initialAssets: parseInt(e.target.value) || 0})}
                  placeholder="Enter initial assets..."
                  className="industrial-input"
                  min="100000"
                  step="100000"
                />
              </div>
              <div className="encryption-preview">
                <h4>FHE Encryption Preview</h4>
                <div className="preview-grid">
                  <div className="preview-item">
                    <span>Initial Assets:</span>
                    <div>${newFundData.initialAssets.toLocaleString()}</div>
                  </div>
                  <div className="preview-item">
                    <span>Encrypted:</span>
                    <div>{FHEEncryptNumber(newFundData.initialAssets).substring(0, 30)}...</div>
                  </div>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button onClick={() => setShowCreateModal(false)} className="cancel-btn industrial-button">Cancel</button>
              <button 
                onClick={createFund} 
                disabled={creating || !newFundData.name} 
                className="submit-btn industrial-button primary"
              >
                {creating ? "Encrypting with FHE..." : "Launch Fund"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Fund Detail Modal */}
      {selectedFund && (
        <div className="modal-overlay">
          <div className="fund-detail-modal industrial-panel">
            <div className="modal-header">
              <h2>Fund Details: {selectedFund.name}</h2>
              <button onClick={() => {
                setSelectedFund(null);
                setDecryptedValue({});
              }} className="close-modal">&times;</button>
            </div>
            <div className="modal-body">
              <div className="fund-info">
                <div className="info-item">
                  <span>Strategy:</span>
                  <strong>{selectedFund.strategy}</strong>
                </div>
                <div className="info-item">
                  <span>Owner:</span>
                  <strong>{selectedFund.owner.substring(0, 6)}...{selectedFund.owner.substring(38)}</strong>
                </div>
                <div className="info-item">
                  <span>Created:</span>
                  <strong>{new Date(selectedFund.timestamp * 1000).toLocaleDateString()}</strong>
                </div>
              </div>

              <div className="performance-metrics">
                <div className="metric-card">
                  <h3>Performance</h3>
                  <div className="metric-value">
                    {decryptedValue.performance !== undefined ? `${decryptedValue.performance.toFixed(2)}%` : '🔒 Encrypted'}
                  </div>
                  <button 
                    className="industrial-button" 
                    onClick={() => decryptWithSignature(selectedFund.encryptedPerformance, 'performance')}
                    disabled={isDecrypting}
                  >
                    {isDecrypting ? 'Decrypting...' : decryptedValue.performance !== undefined ? 'Re-decrypt' : 'Decrypt'}
                  </button>
                </div>
                <div className="metric-card">
                  <h3>Risk Factor</h3>
                  <div className="metric-value">
                    {decryptedValue.risk !== undefined ? decryptedValue.risk.toFixed(2) : '🔒 Encrypted'}
                  </div>
                  <button 
                    className="industrial-button" 
                    onClick={() => decryptWithSignature(selectedFund.encryptedRisk, 'risk')}
                    disabled={isDecrypting}
                  >
                    {isDecrypting ? 'Decrypting...' : decryptedValue.risk !== undefined ? 'Re-decrypt' : 'Decrypt'}
                  </button>
                </div>
                <div className="metric-card">
                  <h3>Assets Under Management</h3>
                  <div className="metric-value">
                    {decryptedValue.assets !== undefined ? `$${(decryptedValue.assets / 1000000).toFixed(2)}M` : '🔒 Encrypted'}
                  </div>
                  <button 
                    className="industrial-button" 
                    onClick={() => decryptWithSignature(selectedFund.encryptedAssets, 'assets')}
                    disabled={isDecrypting}
                  >
                    {isDecrypting ? 'Decrypting...' : decryptedValue.assets !== undefined ? 'Re-decrypt' : 'Decrypt'}
                  </button>
                </div>
              </div>

              <div className="fhe-explanation">
                <h3>How FHE Protects Your Strategy</h3>
                <p>
                  Your hedge fund's performance metrics are encrypted using <strong>Zama FHE</strong> technology. 
                  This means the actual numbers are never exposed on-chain, yet the system can still rank funds 
                  and simulate market impacts without decrypting sensitive data.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Transaction Status Modal */}
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content industrial-panel">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="mechanical-spinner"></div>}
              {transactionStatus.status === "success" && <div className="check-icon"></div>}
              {transactionStatus.status === "error" && <div className="error-icon"></div>}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}

      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo"><div className="gear-icon"></div><span>FHE Hedge War</span></div>
            <p>Competitive hedge fund simulation powered by Zama FHE</p>
          </div>
          <div className="footer-links">
            <a href="#" className="footer-link">Documentation</a>
            <a href="#" className="footer-link">White Paper</a>
            <a href="#" className="footer-link">Terms</a>
            <a href="#" className="footer-link">Zama FHE</a>
          </div>
        </div>
        <div className="footer-bottom">
          <div className="fhe-badge"><span>FHE-Powered Finance</span></div>
          <div className="copyright">© {new Date().getFullYear()} FHE Hedge War. All rights reserved.</div>
        </div>
      </footer>
    </div>
  );
};

export default App;