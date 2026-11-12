import { useCallback, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { useApp } from "@modelcontextprotocol/ext-apps/react";
import type { App as McpApp } from "@modelcontextprotocol/ext-apps/react";
import { AvocadoIcon, BreadIcon, EggIcon, JarIcon, TomatoIcon } from "./icons";

type CartItem = {
  name: string;
  quantity: number;
  [key: string]: unknown;
};

type CartSnapshot = {
  cartId: string;
  items: CartItem[];
};

type CartState = Omit<CartSnapshot, "cartId"> & { cartId?: string };

function parseCartSnapshot(value: unknown): CartSnapshot | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const snapshot = value as Partial<CartSnapshot>;
  if (
    typeof snapshot.cartId !== "string" ||
    !Array.isArray(snapshot.items) ||
    !snapshot.items.every(
      (item) =>
        item !== null &&
        typeof item === "object" &&
        typeof item.name === "string" &&
        typeof item.quantity === "number"
    )
  ) {
    return null;
  }

  return snapshot as CartSnapshot;
}

function usePrettyJson(value: unknown): string {
  return useMemo(() => {
    if (value === undefined || value === null) {
      return "null";
    }

    try {
      return JSON.stringify(value, null, 2);
    } catch (error) {
      return `<<unable to render: ${error}>>`;
    }
  }, [value]);
}

function JsonPanel({ label, value }: { label: string; value: unknown }) {
  const pretty = usePrettyJson(value);

  return (
    <section className="rounded-2xl border border-black/20 bg-[#fffaf5] p-4">
      <header className="mb-3">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-black/60">
          {label}
        </p>
      </header>
      <pre className="max-h-64 overflow-auto rounded-xl bg-white p-3 font-mono text-xs text-black/70 shadow-sm">
        {pretty}
      </pre>
    </section>
  );
}

const suggestedItems = [
  {
    name: "Eggs",
    description: "Breakfast basics",
    Icon: EggIcon,
  },
  {
    name: "Bread",
    description: "Fresh and toasty",
    Icon: BreadIcon,
  },
  {
    name: "Tomatoes",
    description: "Juicy and bright",
    Icon: TomatoIcon,
  },
  {
    name: "Avocados",
    description: "Perfectly ripe",
    Icon: AvocadoIcon,
  },
];

const iconMatchers = [
  { keywords: ["egg", "eggs"], Icon: EggIcon },
  { keywords: ["bread"], Icon: BreadIcon },
  { keywords: ["tomato", "tomatoes"], Icon: TomatoIcon },
  { keywords: ["avocado", "avocados"], Icon: AvocadoIcon },
];

function App() {
  const [cartState, setCartState] = useState<CartState>({ items: [] });
  const [isUpdating, setIsUpdating] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const updateCartFromResult = useCallback(
    (result: { structuredContent?: unknown }) => {
      const snapshot = parseCartSnapshot(result.structuredContent);
      if (snapshot) {
        setCartState(snapshot);
      }
    },
    []
  );
  const onAppCreated = useCallback(
    (app: McpApp) => {
      app.ontoolresult = updateCartFromResult;
    },
    [updateCartFromResult]
  );
  const { app } = useApp({
    appInfo: { name: "shopping-cart", version: "1.0.0" },
    capabilities: {},
    onAppCreated,
  });
  const cartItems = cartState.items;
  const animationStyles = `
    @keyframes fadeUp {
      from { opacity: 0; transform: translateY(10px); }
      to { opacity: 1; transform: translateY(0); }
    }
  `;

  const callCartTool = useCallback(
    async (name: string, args: Record<string, unknown>) => {
      if (!app) {
        setErrorMessage("The cart is not connected to its MCP server yet.");
        return;
      }

      setIsUpdating(true);
      setErrorMessage(null);
      try {
        const result = await app.callServerTool({
          name,
          arguments: args,
        });
        if (result.isError) {
          const message = result.content
            .map((item) => (item.type === "text" ? item.text : ""))
            .filter(Boolean)
            .join(" ");
          throw new Error(message || "The cart update failed.");
        }
        updateCartFromResult(result);
      } catch (error) {
        console.error("[shopping-cart] Cart update failed", error);
        setErrorMessage("Could not update the cart. Please try again.");
      } finally {
        setIsUpdating(false);
      }
    },
    [app, updateCartFromResult]
  );

  function addItem(name: string) {
    if (!name || isUpdating) {
      return;
    }

    void callCartTool("add_to_cart", {
      items: [{ name, quantity: 1 }],
      ...(cartState.cartId ? { cartId: cartState.cartId } : {}),
    });
  }

  function adjustQuantity(name: string, delta: number) {
    if (!cartState.cartId || !name || delta === 0 || isUpdating) {
      return;
    }

    const currentItem = cartItems.find((item) => item.name === name);
    if (!currentItem) {
      return;
    }

    const nextQuantity = Math.max(0, currentItem.quantity + delta);
    const items =
      nextQuantity === 0
        ? cartItems.filter((item) => item.name !== name)
        : cartItems.map((item) =>
            item.name === name ? { ...item, quantity: nextQuantity } : item
          );
    void callCartTool("update_cart", {
      cartId: cartState.cartId,
      items,
    });
  }

  function getIconForItem(name: string) {
    const words = name
      .toLowerCase()
      .replace(/[^a-z]/g, " ")
      .split(/\s+/)
      .filter(Boolean);
    for (const entry of iconMatchers) {
      if (entry.keywords.some((keyword) => words.includes(keyword))) {
        return entry.Icon;
      }
    }
    return JarIcon;
  }

  const itemCards = cartItems.length ? (
    <div className="space-y-3">
      {cartItems.map((item) => (
        <div
          key={item.name}
          className="flex items-center justify-between rounded-2xl border border-black/20 bg-[#fffaf5] p-3"
        >
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white shadow-sm">
              {(() => {
                const Icon = getIconForItem(item.name);
                return <Icon className="h-6 w-6" />;
              })()}
            </div>
            <div>
              <p className="text-sm font-semibold text-black">{item.name}</p>
              <p className="text-xs text-black/60">
                Qty <span className="font-mono">{item.quantity ?? 0}</span>
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => adjustQuantity(item.name, -1)}
              className="h-8 w-8 rounded-full border border-black/30 text-lg font-semibold text-black/70 transition hover:bg-white"
              aria-label={`Decrease ${item.name}`}
            >
              -
            </button>
            <button
              type="button"
              onClick={() => adjustQuantity(item.name, 1)}
              className="h-8 w-8 rounded-full border border-black/30 text-lg font-semibold text-black/70 transition hover:bg-white"
              aria-label={`Increase ${item.name}`}
            >
              +
            </button>
          </div>
        </div>
      ))}
    </div>
  ) : (
    <div className="rounded-2xl border border-dashed border-black/40 bg-[#fffaf5] p-6 text-center text-sm text-black/60">
      Your cart is empty. Add a few items to get started.
    </div>
  );

  return (
    <div
      className="min-h-screen w-full bg-white text-black bg-[radial-gradient(circle_at_top_left,_#fff7ed_0,_#ffffff_55%),radial-gradient(circle_at_bottom_right,_#eef2ff_0,_#ffffff_45%)]"
      style={{
        fontFamily: '"Trebuchet MS", "Gill Sans", "Lucida Grande", sans-serif',
      }}
      data-theme="light"
    >
      <style>{animationStyles}</style>
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-8 md:px-6 lg:px-8">
        <header
          className="space-y-2"
          style={{ animation: "fadeUp 0.6s ease-out both" }}
        >
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-black/60">
            Simple cart
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">
            Pick a few essentials
          </h1>
          <p className="text-sm text-black/70">
            Update your cart through the chat or tap to add a suggestion or
            adjust quantities.
          </p>
        </header>

        <div
          className="grid gap-8 lg:grid-cols-[1.4fr_1fr]"
          style={{
            animation: "fadeUp 0.7s ease-out both",
            animationDelay: "80ms",
          }}
        >
          <section className="space-y-4">
            <header className="flex items-center justify-between">
              <p className="text-sm font-semibold uppercase tracking-widest text-black/70">
                Suggested items
              </p>
            </header>
            <div className="grid gap-4 sm:grid-cols-2">
              {suggestedItems.map(({ name, description, Icon }, index) => (
                <div
                  key={name}
                  className="flex items-center justify-between gap-3 rounded-2xl border border-black/20 bg-[#fffaf5] p-4"
                  style={{
                    animation: "fadeUp 0.5s ease-out both",
                    animationDelay: `${120 + index * 80}ms`,
                  }}
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white shadow-sm">
                      <Icon className="h-7 w-7" />
                    </div>
                    <div>
                      <p className="text-base font-semibold text-black">
                        {name}
                      </p>
                      <p className="text-xs text-black/60">{description}</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={isUpdating || !app}
                    onClick={() => addItem(name)}
                    className="rounded-full bg-amber-200 px-3 py-1.5 text-xs font-semibold text-black transition hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    Add
                  </button>
                </div>
              ))}
            </div>
          </section>

          <section className="space-y-4">
            <header className="flex items-center justify-between">
              <p className="text-sm font-semibold uppercase tracking-widest text-black/70">
                Cart
              </p>
              <span className="text-xs text-black/60">
                {cartItems.length} items
              </span>
            </header>
            {errorMessage && (
              <p role="alert" className="text-sm text-red-700">
                {errorMessage}
              </p>
            )}
            {itemCards}
            <button
              type="button"
              disabled={cartItems.length === 0 || isUpdating}
              className="w-full rounded-2xl border border-black/30 bg-white py-3 text-sm font-semibold text-black/70 transition hover:border-black/50 disabled:cursor-not-allowed disabled:opacity-70"
            >
              Check out
            </button>
          </section>
        </div>

        <section className="space-y-3">
          <header className="flex items-center justify-between">
            <p className="text-sm font-semibold uppercase tracking-widest text-black/70">
              Server cart state
            </p>
            <span className="text-xs text-black/60">
              {app ? "Connected" : "Connecting"}
            </span>
          </header>
          <JsonPanel label="structuredContent" value={cartState} />
        </section>
      </div>
    </div>
  );
}

const rootElement = document.getElementById("shopping-cart-root");
if (!rootElement) {
  throw new Error("Missing shopping-cart-root element");
}

createRoot(rootElement).render(<App />);
