import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { setupAuth, isAuthenticated } from "./replitAuth";
import { insertUserProfileSchema } from "@shared/schema";
import { fromError } from "zod-validation-error";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // Auth middleware
  await setupAuth(app);

  // Auth routes
  app.get('/api/auth/user', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const user = await storage.getUser(userId);
      
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      
      // Also get profile
      const profile = await storage.getUserProfile(userId);
      
      res.json({
        ...user,
        profile: profile || null,
      });
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });

  // User profile routes
  app.get('/api/profile', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const profile = await storage.getUserProfile(userId);
      if (!profile) {
        return res.json({ userId, licensedStates: [], preferredTypes: [] });
      }
      res.json(profile);
    } catch (error) {
      console.error("Error fetching profile:", error);
      res.status(500).json({ message: "Failed to fetch profile" });
    }
  });

  app.put('/api/profile', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      
      const validation = insertUserProfileSchema.safeParse({
        ...req.body,
        userId,
      });

      if (!validation.success) {
        return res.status(400).json({
          message: fromError(validation.error).toString(),
        });
      }

      const profile = await storage.upsertUserProfile(validation.data);
      res.json(profile);
    } catch (error) {
      console.error("Error updating profile:", error);
      res.status(500).json({ message: "Failed to update profile" });
    }
  });

  // Lead routes
  app.get('/api/leads', async (req, res) => {
    try {
      const { types, states, minPrice, maxPrice } = req.query;
      
      const filters: any = {};
      
      if (types) {
        filters.types = Array.isArray(types) ? types : [types];
      }
      
      if (states) {
        filters.states = Array.isArray(states) ? states : [states];
      }
      
      if (minPrice) {
        filters.minPrice = parseFloat(minPrice as string);
      }
      
      if (maxPrice) {
        filters.maxPrice = parseFloat(maxPrice as string);
      }

      const leads = await storage.getLeads(filters);
      res.json(leads);
    } catch (error) {
      console.error("Error fetching leads:", error);
      res.status(500).json({ message: "Failed to fetch leads" });
    }
  });

  app.get('/api/leads/:id', async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const lead = await storage.getLead(id);
      
      if (!lead) {
        return res.status(404).json({ message: "Lead not found" });
      }
      
      res.json(lead);
    } catch (error) {
      console.error("Error fetching lead:", error);
      res.status(500).json({ message: "Failed to fetch lead" });
    }
  });

  // Purchase route
  app.post('/api/leads/:id/purchase', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const leadId = parseInt(req.params.id);

      const order = await storage.purchaseLead(leadId, userId);
      res.json(order);
    } catch (error: any) {
      console.error("Error purchasing lead:", error);
      res.status(400).json({ message: error.message || "Failed to purchase lead" });
    }
  });

  // Order routes
  app.get('/api/orders', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const orders = await storage.getUserOrders(userId);
      res.json(orders);
    } catch (error) {
      console.error("Error fetching orders:", error);
      res.status(500).json({ message: "Failed to fetch orders" });
    }
  });

  // Balance routes
  app.post('/api/balance/add', isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const { amount } = req.body;

      if (!amount || amount <= 0) {
        return res.status(400).json({ message: "Invalid amount" });
      }

      const user = await storage.updateUserBalance(userId, amount);
      res.json(user);
    } catch (error) {
      console.error("Error adding balance:", error);
      res.status(500).json({ message: "Failed to add balance" });
    }
  });

  return httpServer;
}
