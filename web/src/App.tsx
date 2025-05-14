import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useLayoutEffect,
} from "react";
import { ethers } from "ethers";
import { CoinbaseWalletSDK } from "@coinbase/wallet-sdk";
import { FixedSizeGrid as Grid } from "react-window";
import type { GridChildComponentProps } from "react-window";
import "./App.css";

// Base Sepolia constants ------------------------------------------------
const BASE_SEPOLIA_CHAIN_ID = 84532;
const BASE_SEPOLIA_CHAIN_ID_HEX = "0x14A34"; // 84532 in hex
const BASE_SEPOLIA_RPC = "https://base-sepolia-rpc.publicnode.com";

// Deployed contract address
const CONTRACT_ADDRESS = "0x310E0b2E9030e97887C63E4E9bae90D45C7dcCc6";

// Minimal ABI covering what the front-end needs
const CONTRACT_ABI = [
  "function claim(uint256) external returns (bool)",
  "function isClaimed(uint256) view returns (bool)",
  "function totalSupply() view returns (uint256)",
  "function MAX_SUPPLY() view returns (uint256)",
];

// Local asset (placed at the workspace root) – Vite serves from project root
const LOGO_SRC = "/Base_Network_Logo.png";

// Read-only provider & contract for pre-connection queries
const readProvider = new ethers.JsonRpcProvider(
  BASE_SEPOLIA_RPC,
  BASE_SEPOLIA_CHAIN_ID
);
const readContract = new ethers.Contract(
  "0x310E0b2E9030e97887C63E4E9bae90D45C7dcCc6",
  [
    "function isClaimed(uint256) view returns (bool)",
    "function totalSupply() view returns (uint256)",
    "function MAX_SUPPLY() view returns (uint256)",
  ],
  readProvider
);

//-----------------------------------------------------------------------
export default function App() {
  // provider & signer stored for potential future use; prefix with underscore to silence TS warnings
  const [_provider, setProvider] = useState<ethers.BrowserProvider>();
  const [_signer, setSigner] = useState<ethers.Signer>();
  const [contract, setContract] = useState<ethers.Contract>();
  const [account, setAccount] = useState<string>();
  const [totalSupply, setTotalSupply] = useState<number>(0);
  const [maxSupply, setMaxSupply] = useState<number>(1_000_000);
  const [txPending, setTxPending] = useState(false);

  // Track which cells the current user has clicked (client-side only)
  const [clicked, setClicked] = useState<Set<number>>(new Set());

  // Track viewport width to compute column count so we avoid horizontal scrolling
  const [viewportWidth, setViewportWidth] = useState<number>(window.innerWidth);

  // Keep a cache of indices already confirmed claimed on-chain
  const [remoteClaimedSet, setRemoteClaimedSet] = useState<Set<number>>(
    new Set()
  );

  useLayoutEffect(() => {
    const handleResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Initialise Coinbase wallet connection ------------------------------------------------
  const connectWallet = useCallback(async () => {
    // Instantiate Coinbase Wallet SDK
    const cbw = new CoinbaseWalletSDK({
      appName: "MillionBase",
      appLogoUrl: LOGO_SRC,
    });

    // Coinbase Wallet SDK v4: makeWeb3Provider accepts a preference object (or nothing).
    // We still create the provider without params, then ensure the user is on Base Sepolia.
    const ethereum = cbw.makeWeb3Provider();

    // Attempt to switch to Base Sepolia; if the chain is missing, add it then switch.
    try {
      await ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: BASE_SEPOLIA_CHAIN_ID_HEX }],
      });
    } catch (switchErr: any) {
      // 4902 = chain not added to wallet
      if (switchErr.code === 4902) {
        await ethereum.request({
          method: "wallet_addEthereumChain",
          params: [
            {
              chainId: BASE_SEPOLIA_CHAIN_ID_HEX,
              chainName: "Base Sepolia Testnet",
              rpcUrls: [BASE_SEPOLIA_RPC],
              nativeCurrency: {
                name: "Sepolia ETH",
                symbol: "ETH",
                decimals: 18,
              },
              blockExplorerUrls: ["https://sepolia.basescan.org"],
            },
          ],
        });
        // try switching again after adding
        await ethereum.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: BASE_SEPOLIA_CHAIN_ID_HEX }],
        });
      } else {
        throw switchErr;
      }
    }
    const browserProvider = new ethers.BrowserProvider(
      ethereum as unknown as ethers.Eip1193Provider,
      BASE_SEPOLIA_CHAIN_ID
    );
    setProvider(browserProvider);

    const [addr] = (await browserProvider.send(
      "eth_requestAccounts",
      []
    )) as string[];
    setAccount(addr);
    const s = await browserProvider.getSigner();
    setSigner(s);

    const c = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, s);
    setContract(c);
  }, []);

  // Fetch supply figures ------------------------------------------------------------------
  const refreshSupply = useCallback(async () => {
    const target = contract ?? readContract;
    const [supplyBN, maxBN] = await Promise.all([
      target.totalSupply(),
      target.MAX_SUPPLY(),
    ]);
    setTotalSupply(Number(supplyBN));
    setMaxSupply(Number(maxBN));
  }, [contract]);

  useEffect(() => {
    refreshSupply();
  }, [contract, refreshSupply]);

  // Claim handler -------------------------------------------------------------------------
  const claim = useCallback(
    async (cellIndex: number) => {
      if (!contract || txPending) return;
      try {
        setTxPending(true);
        const tx = await contract.claim(cellIndex);
        await tx.wait();
        await refreshSupply();

        // update client-side clicked set
        setClicked((prev) => new Set(prev).add(cellIndex));
      } catch (err) {
        console.error(err);
        // eslint-disable-next-line no-alert
        alert((err as Error).message);
      } finally {
        setTxPending(false);
      }
    },
    [contract, refreshSupply, txPending]
  );

  // Grid renderer -------------------------------------------------------------------------
  const columnWidth = 24;

  const columns = Math.floor((viewportWidth - 32) / columnWidth) || 1; // 32 for some padding
  const rowCount = Math.ceil(1_000_000 / columns);

  const Cell = useCallback(
    ({ columnIndex, rowIndex, style }: GridChildComponentProps) => {
      const cellIndex = rowIndex * columns + columnIndex;
      if (cellIndex >= 1_000_000) return null;

      // Check local cache; if unknown, query chain asynchronously
      let isRemoteClaimed = remoteClaimedSet.has(cellIndex);
      const queryFrom = contract ?? readContract;
      if (!isRemoteClaimed && queryFrom) {
        // Fire-and-forget query; update state when resolved
        queryFrom
          .isClaimed(cellIndex)
          .then((claimed: boolean) => {
            if (claimed) {
              setRemoteClaimedSet((prev) => {
                const next = new Set(prev);
                next.add(cellIndex);
                return next;
              });
            }
          })
          .catch(() => {});
      }

      const isClicked = isRemoteClaimed || clicked.has(cellIndex);

      return (
        <div
          style={{
            ...style,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor:
              txPending || totalSupply >= maxSupply ? "not-allowed" : "pointer",
            opacity: totalSupply >= maxSupply ? 0.4 : isClicked ? 0.5 : 1,
            filter: isClicked ? "grayscale(100%)" : undefined,
          }}
          onClick={() => claim(cellIndex)}
        >
          {/* eslint-disable-next-line jsx-a11y/alt-text */}
          <img src={LOGO_SRC} style={{ width: 20, height: 20 }} />
        </div>
      );
    },
    [
      claim,
      clicked,
      columns,
      txPending,
      totalSupply,
      maxSupply,
      remoteClaimedSet,
    ]
  );

  // Grid dimensions – memoize to avoid re-renders
  const gridProps = useMemo(
    () => ({
      columnCount: columns,
      rowCount,
      columnWidth,
      rowHeight: 24,
      width: columns * columnWidth,
      height: Math.min(window.innerHeight - 160, 600),
    }),
    [columns, rowCount]
  );

  //-----------------------------------------------------------------------
  return (
    <div className="app-container">
      <header>
        <h1>MillionBase</h1>
        {!account ? (
          <button onClick={connectWallet}>Connect Coinbase Wallet</button>
        ) : (
          <p>
            Connected: {account.slice(0, 6)}…{account.slice(-4)}
          </p>
        )}
      </header>

      <p>
        Minted {totalSupply} / {maxSupply}
      </p>
      {totalSupply >= maxSupply && <h2>All tokens claimed! 🎉</h2>}

      <Grid
        {...gridProps}
        className="logo-grid"
        overscanRowCount={5}
        overscanColumnCount={5}
      >
        {Cell}
      </Grid>

      {txPending && <p>Transaction pending…</p>}
    </div>
  );
}
