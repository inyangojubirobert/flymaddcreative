import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

import type { CatalogueItem } from '../api/catalogue';
import type { CartQuoteLine } from '../api/cart';

// Shopping cart for the marketplace. Holds a price snapshot so the floating
// cart can show a running total offline; the checkout page re-prices
// everything server-side (getCartQuote) and syncs the snapshot back.

export const MAX_CART_LINES = 20; // must match lib/catalogueCart.js
export const MAX_LINE_QUANTITY = 99;

export type CartLine = {
  item_id: string;
  quantity: number;
  price_usd: number;
  title?: string;
  seller_username?: string;
  image?: string | null;
};

type CartContextValue = {
  lines: CartLine[];
  count: number;
  subtotalUsd: number;
  isFull: boolean;
  has: (itemId: string) => boolean;
  toggle: (item: CatalogueItem) => boolean;
  setQuantity: (itemId: string, quantity: number) => void;
  remove: (itemId: string) => void;
  clear: () => void;
  syncFromQuote: (quoteLines: CartQuoteLine[]) => void;
};

const CartContext = createContext<CartContextValue | undefined>(undefined);

// Only ids, quantities and prices are persisted - keeps the value well under
// SecureStore's ~2 KB comfort limit at MAX_CART_LINES.
const STORAGE_KEY = 'onedream_cart_v1';
type StoredLine = { i: string; q: number; p: number };

const cartStorage = {
  async get(): Promise<StoredLine[]> {
    try {
      const raw = Platform.OS === 'web' ? globalThis.localStorage?.getItem(STORAGE_KEY) : await SecureStore.getItemAsync(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  },
  async set(lines: CartLine[]) {
    const raw = JSON.stringify(lines.map((line): StoredLine => ({ i: line.item_id, q: line.quantity, p: line.price_usd })));
    try {
      if (Platform.OS === 'web') globalThis.localStorage?.setItem(STORAGE_KEY, raw);
      else await SecureStore.setItemAsync(STORAGE_KEY, raw);
    } catch {
      // A cart that doesn't survive a restart is an inconvenience, not an error.
    }
  },
};

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>([]);
  const hydrated = useRef(false);

  useEffect(() => {
    cartStorage.get().then((stored) => {
      setLines((current) => {
        if (current.length) return current; // user already added something while loading
        return stored
          .filter((line) => typeof line?.i === 'string' && line.q > 0)
          .slice(0, MAX_CART_LINES)
          .map((line) => ({ item_id: line.i, quantity: Math.min(MAX_LINE_QUANTITY, Math.floor(line.q)), price_usd: Number(line.p) || 0 }));
      });
      hydrated.current = true;
    });
  }, []);

  useEffect(() => {
    if (hydrated.current) void cartStorage.set(lines);
  }, [lines]);

  const has = useCallback((itemId: string) => lines.some((line) => line.item_id === itemId), [lines]);

  /** Adds or removes a listing. Returns false only when adding to a full cart. */
  const toggle = useCallback((item: CatalogueItem) => {
    const inCart = lines.some((line) => line.item_id === item.id);
    if (!inCart && lines.length >= MAX_CART_LINES) return false;
    setLines((current) => {
      if (inCart) return current.filter((line) => line.item_id !== item.id);
      if (current.some((line) => line.item_id === item.id)) return current;
      return [...current, {
        item_id: item.id,
        quantity: 1,
        price_usd: Number(item.price_usd) || 0,
        title: item.title,
        seller_username: item.seller_username,
        image: item.images?.[0] ?? null,
      }];
    });
    return true;
  }, [lines]);

  const setQuantity = useCallback((itemId: string, quantity: number) => {
    const next = Math.max(1, Math.min(MAX_LINE_QUANTITY, Math.floor(quantity)));
    setLines((current) => current.map((line) => (line.item_id === itemId ? { ...line, quantity: next } : line)));
  }, []);

  const remove = useCallback((itemId: string) => {
    setLines((current) => current.filter((line) => line.item_id !== itemId));
  }, []);

  const clear = useCallback(() => setLines([]), []);

  const syncFromQuote = useCallback((quoteLines: CartQuoteLine[]) => {
    const byId = new Map(quoteLines.map((line) => [line.item_id, line]));
    setLines((current) => {
      let changed = false;
      const next = current.map((line) => {
        const quoted = byId.get(line.item_id);
        if (!quoted) return line;
        const price = quoted.problem ? line.price_usd : quoted.unit_price_usd;
        if (price === line.price_usd && line.title === quoted.title && line.seller_username === (quoted.seller_username ?? undefined)) return line;
        changed = true;
        return { ...line, price_usd: price, title: quoted.title, seller_username: quoted.seller_username ?? undefined, image: quoted.image };
      });
      return changed ? next : current;
    });
  }, []);

  const value = useMemo<CartContextValue>(() => ({
    lines,
    count: lines.reduce((sum, line) => sum + line.quantity, 0),
    subtotalUsd: Math.round(lines.reduce((sum, line) => sum + Math.round(line.price_usd * 100) * line.quantity, 0)) / 100,
    isFull: lines.length >= MAX_CART_LINES,
    has,
    toggle,
    setQuantity,
    remove,
    clear,
    syncFromQuote,
  }), [lines, has, toggle, setQuantity, remove, clear, syncFromQuote]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const context = useContext(CartContext);
  if (!context) throw new Error('useCart must be used inside CartProvider');
  return context;
}
