'use client';

import { useState, useRef, useEffect } from "react";
import { ChevronDown, LogOut } from "lucide-react";
import { useWallet } from "./WalletProvider";
import { t } from "@/lib/i18n";

function shorten(address: string): string {
  return address.length <= 10 ? address : `…${address.slice(-6)}`;
}

export default function AccountSwitcher() {
  const { address, connectedAddresses, pending, disconnect, switchAccount } =
    useWallet();
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        menuRef.current &&
        !menuRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  if (!address) return null;

  const otherAddresses = connectedAddresses.filter((a) => a !== address);

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="px-4 py-1.5 border border-[#1e2d40] text-slate-300 hover:bg-[#162032] rounded-md transition-colors font-mono flex items-center gap-2"
        aria-label={t("nav.accountMenu", { address })}
        aria-expanded={isOpen}
        aria-haspopup="menu"
      >
        {shorten(address)}
        <ChevronDown size={14} className={`transition-transform ${isOpen ? "rotate-180" : ""}`} />
      </button>

      {isOpen && (
        <div
          className="absolute right-0 mt-2 w-56 bg-[#0d1520] border border-[#1a2535] rounded-lg shadow-lg z-50"
          role="menu"
        >
          <div className="p-3 border-b border-[#1a2535]">
            <div className="text-xs text-slate-500 mb-2">
              {t("nav.currentAccount")}
            </div>
            <div className="text-sm font-mono text-slate-200 break-all">
              {address}
            </div>
          </div>

          {otherAddresses.length > 0 && (
            <>
              <div className="p-3 border-b border-[#1a2535]">
                <div className="text-xs text-slate-500 mb-2">
                  {t("nav.connectedAccounts")}
                </div>
                <div className="space-y-1">
                  {otherAddresses.map((addr) => (
                    <button
                      key={addr}
                      onClick={() => {
                        switchAccount(addr).catch(() => {});
                        setIsOpen(false);
                      }}
                      disabled={pending}
                      className="w-full text-left px-2 py-1.5 text-xs font-mono text-slate-400 hover:text-slate-200 hover:bg-[#162032] rounded transition-colors disabled:opacity-50 break-all"
                    >
                      {addr}
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          <button
            onClick={() => {
              disconnect();
              setIsOpen(false);
            }}
            className="w-full text-left px-3 py-2 text-xs text-slate-400 hover:text-red-400 hover:bg-red-950/20 rounded-b-lg transition-colors flex items-center gap-2"
            role="menuitem"
          >
            <LogOut size={14} />
            {t("nav.disconnect")}
          </button>
        </div>
      )}
    </div>
  );
}
