import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createRequire } from "node:module";
import { OdaClient } from "./oda-client.js";
import fs from "fs";
import path from "path";

const { version } = createRequire(import.meta.url)("../package.json");

export class OdaServer {
  private mcpServer: McpServer;
  private client: OdaClient | null = null;
  private logPath: string;

  constructor(private dataDir: string) {
    this.logPath = path.join(dataDir, "mcp-oda.log");
    this.mcpServer = new McpServer({ name: "mcp-oda", version });
    this.registerTools();

    process.on("SIGINT", () => {
      process.exit(0);
    });
  }

  private getClient(): OdaClient {
    if (!this.client) throw new Error("Client not initialized");
    return this.client;
  }

  private logError(tool: string, args: unknown, error: unknown) {
    try {
      fs.mkdirSync(this.dataDir, { recursive: true });
      const entry = JSON.stringify({
        timestamp: new Date().toISOString(),
        level: "error",
        tool,
        args,
        error: error instanceof Error ? error.message : String(error),
      });
      fs.appendFileSync(this.logPath, entry + "\n");
    } catch {
      // Never let logging break the server
    }
  }

  private toolHandler<T>(name: string, fn: (args: T) => Promise<any>) {
    return async (args: T) => {
      try {
        return await fn(args);
      } catch (e) {
        this.logError(name, args, e);
        throw e;
      }
    };
  }

  private textResult(text: string) {
    return { content: [{ type: "text" as const, text }] };
  }

  private jsonResult(data: unknown) {
    return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
  }

  private registerTools() {
    this.mcpServer.registerTool("check_login", {
      description: "Check if the user is logged in to Oda.",
    }, this.toolHandler("check_login", async () => {
      const userName = await this.getClient().checkUser();
      return this.jsonResult({ logged_in: !!userName });
    }));

    this.mcpServer.registerTool("cart_get_contents", {
      description: "Get the current shopping cart contents.",
    }, this.toolHandler("cart_get_contents", async () => {
      return this.jsonResult(await this.getClient().getCartContents());
    }));

    this.mcpServer.registerTool("cart_clear", {
      description: "Remove all items from the shopping cart.",
    }, this.toolHandler("cart_clear", async () => {
      await this.getClient().clearCart();
      return this.textResult("Cart cleared");
    }));

    this.mcpServer.registerTool("cart_remove_item", {
      description: "Remove a product from the cart by product ID.",
      inputSchema: { id: z.number(), count: z.number().optional() },
    }, this.toolHandler("cart_remove_item", async ({ id, count }) => {
      await this.getClient().removeFromCart(id, count);
      return this.textResult("Item removed");
    }));

    this.mcpServer.registerTool("products_search", {
      description: "Search for products on Oda.",
      inputSchema: { query: z.string(), page: z.number().optional() },
    }, this.toolHandler("products_search", async ({ query, page }) => {
      return this.jsonResult(await this.getClient().searchProducts(query, page));
    }));

    this.mcpServer.registerTool("product_add_to_cart", {
      description: "Add a product to the cart by product ID.",
      inputSchema: { id: z.number(), count: z.number().optional() },
    }, this.toolHandler("product_add_to_cart", async ({ id, count }) => {
      await this.getClient().addToCart(id, count);
      return this.textResult("Product added");
    }));

    this.mcpServer.registerTool("recipes_search", {
      description: "Search for recipes on Oda.",
      inputSchema: {
        query: z.string().optional(),
        page: z.number().optional(),
        filter_ids: z.array(z.string()).optional(),
      },
    }, this.toolHandler("recipes_search", async ({ query, page, filter_ids }) => {
      return this.jsonResult(await this.getClient().searchRecipes(query, page, filter_ids));
    }));

    this.mcpServer.registerTool("recipes_get_details", {
      description: "Get recipe details by recipe ID.",
      inputSchema: { id: z.number() },
    }, this.toolHandler("recipes_get_details", async ({ id }) => {
      return this.jsonResult(await this.getClient().getRecipeDetails(id));
    }));

    this.mcpServer.registerTool("recipe_add_to_cart", {
      description: "Add recipe ingredients to cart by recipe ID.",
      inputSchema: { id: z.number(), portions: z.number() },
    }, this.toolHandler("recipe_add_to_cart", async ({ id, portions }) => {
      await this.getClient().addRecipeToCart(id, portions);
      return this.textResult("Recipe added");
    }));

    this.mcpServer.registerTool("recipe_remove_from_cart", {
      description: "Remove a recipe and its ingredients from the cart by recipe ID.",
      inputSchema: { id: z.number() },
    }, this.toolHandler("recipe_remove_from_cart", async ({ id }) => {
      await this.getClient().removeRecipeFromCart(id);
      return this.textResult("Recipe removed");
    }));

    this.mcpServer.registerTool("delivery_slots_list", {
      description: "List available delivery slots. Returns slots with day/time windows, price, availability, and delivery addresses.",
      inputSchema: {
        num_days: z.number().optional(),
        from_index: z.number().optional(),
      },
    }, this.toolHandler("delivery_slots_list", async ({ num_days, from_index }) => {
      const data = await this.getClient().getDeliverySlots(num_days, from_index);
      return this.jsonResult(data);
    }));

    this.mcpServer.registerTool("delivery_slot_select", {
      description: "Select a delivery slot by slot ID.",
      inputSchema: {
        id: z.number(),
        address_id: z.number().optional(),
        unattended: z.boolean().optional(),
      },
    }, this.toolHandler("delivery_slot_select", async ({ id, address_id, unattended }) => {
      await this.getClient().selectDeliverySlot(id, address_id, unattended);
      return this.textResult("Delivery slot selected");
    }));

    this.mcpServer.registerTool("delivery_addresses_list", {
      description: "List delivery addresses associated with the account.",
      inputSchema: {},
    }, this.toolHandler("delivery_addresses_list", async () => {
      const data = await this.getClient().getDeliverySlots(1, 0);
      return this.jsonResult(data.delivery_addresses);
    }));

    this.mcpServer.registerTool("list_all", {
      description: "List all saved product lists (Oda's reusable shopping lists, distinct from the cart).",
    }, this.toolHandler("list_all", async () => {
      return this.jsonResult(await this.getClient().getProductLists());
    }));

    this.mcpServer.registerTool("list_get", {
      description: "Get a saved product list's contents by list ID.",
      inputSchema: { id: z.number() },
    }, this.toolHandler("list_get", async ({ id }) => {
      return this.jsonResult(await this.getClient().getProductList(id));
    }));

    this.mcpServer.registerTool("list_create", {
      description: "Create a new saved product list.",
      inputSchema: { title: z.string(), description: z.string().optional() },
    }, this.toolHandler("list_create", async ({ title, description }) => {
      return this.jsonResult(await this.getClient().createProductList(title, description));
    }));

    this.mcpServer.registerTool("list_rename", {
      description: "Rename a saved product list or change its description.",
      inputSchema: {
        id: z.number(),
        title: z.string().optional(),
        description: z.string().optional(),
      },
    }, this.toolHandler("list_rename", async ({ id, title, description }) => {
      return this.jsonResult(await this.getClient().renameProductList(id, { title, description }));
    }));

    this.mcpServer.registerTool("list_delete", {
      description: "Delete a saved product list.",
      inputSchema: { id: z.number() },
    }, this.toolHandler("list_delete", async ({ id }) => {
      await this.getClient().deleteProductList(id);
      return this.textResult("List deleted");
    }));

    this.mcpServer.registerTool("list_add_products", {
      description: "Add products to a saved list by product ID and quantity.",
      inputSchema: {
        id: z.number(),
        items: z.array(z.object({ product_id: z.number(), quantity: z.number() })),
      },
    }, this.toolHandler("list_add_products", async ({ id, items }) => {
      return this.jsonResult(await this.getClient().addProductsToList(id, items));
    }));

    this.mcpServer.registerTool("list_remove_product", {
      description: "Remove a product from a saved list by product ID.",
      inputSchema: { id: z.number(), product_id: z.number() },
    }, this.toolHandler("list_remove_product", async ({ id, product_id }) => {
      await this.getClient().removeProductFromList(id, product_id);
      return this.textResult("Product removed from list");
    }));

    this.mcpServer.registerTool("list_add_to_cart", {
      description: "Add every item in a saved list to the cart in one go.",
      inputSchema: { id: z.number() },
    }, this.toolHandler("list_add_to_cart", async ({ id }) => {
      await this.getClient().addProductListToCart(id);
      return this.textResult("List added to cart");
    }));
  }

  async start() {
    fs.mkdirSync(this.dataDir, { recursive: true });

    const cookiePath = path.join(this.dataDir, "cookies.json");
    this.client = new OdaClient(cookiePath);

    const transport = new StdioServerTransport();
    await this.mcpServer.connect(transport);
    console.error("MCP Oda Server running on stdio");
  }

  // Auth helper
  async auth(username?: string, password?: string) {
    if (!username || !password) {
      console.error(
        "HTTP-based auth requires --user and --pass arguments.",
      );
      console.error(
        "Usage: mcp-oda auth login --user <email> --pass <password>",
      );
      process.exit(1);
    }

    fs.mkdirSync(this.dataDir, { recursive: true });
    const cookiePath = path.join(this.dataDir, "cookies.json");
    const client = new OdaClient(cookiePath);

    console.error("Attempting automated login...");
    const success = await client.login(username, password);

    if (success) {
      const userName = await client.checkUser();
      if (userName) {
        console.error(`Successfully logged in as: ${userName}`);
      } else {
        console.error("Login successful (could not determine name).");
      }
    } else {
      console.error(
        "Login failed. Please check your credentials.",
      );
      process.exit(1);
    }
  }

  async checkUser() {
    fs.mkdirSync(this.dataDir, { recursive: true });
    const cookiePath = path.join(this.dataDir, "cookies.json");
    const client = new OdaClient(cookiePath);

    try {
      const userName = await client.checkUser();
      if (userName) {
        console.error(`Logged in as: ${userName}`);
      } else {
        console.error("Not logged in.");
      }
    } catch (e) {
      console.error("Failed to check user:", e);
    }
  }
}
