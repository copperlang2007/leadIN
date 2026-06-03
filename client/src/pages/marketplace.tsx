import { useState, useMemo, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Layout } from "@/components/layout";
import { LeadCard } from "@/components/lead-card";
import { LeadDetailsDialog } from "@/components/lead-details-dialog";
import type { Lead, Order } from "@/lib/types";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { useWebSocketContext } from "@/hooks/useWebSocketContext";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger
} from "@/components/ui/accordion";
import { Filter, X, ArrowUpDown, ChevronDown, CheckCircle2, Loader2 } from "lucide-react";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer";
import heroBg from "@assets/generated_images/abstract_blue_secure_data_network_background.png";

export default function Marketplace() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedLeads, setSelectedLeads] = useState<Lead[]>([]);
  const [priceRange, setPriceRange] = useState([0, 100]);
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);
  const [selectedStates, setSelectedStates] = useState<string[]>([]);
  const [isCompareOpen, setIsCompareOpen] = useState(false);
  const [isFiltersOpen, setIsFiltersOpen] = useState(false);
  const [newLeadIds, setNewLeadIds] = useState<Set<number>>(new Set());
  const [includeDnc, setIncludeDnc] = useState(false);
  const [sortBy, setSortBy] = useState<"relevance" | "mediscore" | "price_asc" | "price_desc" | "newest">("relevance");

  // Details Dialog State
  const [detailsLead, setDetailsLead] = useState<Lead | null>(null);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [isDetailsPurchasing, setIsDetailsPurchasing] = useState(false);

  // Subscribe to shared WebSocket context for real-time new leads (no new connection created)
  const { subscribeToNewLeads } = useWebSocketContext();

  useEffect(() => {
    const unsubscribe = subscribeToNewLeads((lead: any) => {
      setNewLeadIds(prev => {
        const updated = new Set(prev);
        updated.add(lead.id);
        return updated;
      });
      setTimeout(() => {
        setNewLeadIds(prev => {
          const updated = new Set(prev);
          updated.delete(lead.id);
          return updated;
        });
      }, 10000);
      queryClient.invalidateQueries({ predicate: q => typeof q.queryKey[0] === "string" && (q.queryKey[0] as string).startsWith("/api/leads") });
    });
    return unsubscribe;
  }, [subscribeToNewLeads, queryClient]);

  // Build query params
  const queryParams = useMemo(() => {
    const params = new URLSearchParams();
    if (selectedTypes.length > 0) {
      selectedTypes.forEach(type => params.append('types', type));
    }
    if (selectedStates.length > 0) {
      selectedStates.forEach(state => params.append('states', state));
    }
    params.append('minPrice', priceRange[0].toString());
    params.append('maxPrice', priceRange[1].toString());
    if (includeDnc) params.append('includeDnc', 'true');
    return params.toString();
  }, [selectedTypes, selectedStates, priceRange, includeDnc]);

  const { data: rawLeads = [], isLoading } = useQuery<Lead[]>({
    queryKey: [`/api/leads?${queryParams}`],
  });

  // Client-side sort. Backend already org-scopes + price-filters; sort key is
  // a view concern so we keep it local.
  const leads = useMemo(() => {
    const list = [...rawLeads];
    switch (sortBy) {
      case "mediscore":
        list.sort((a, b) => (b.mediscore ?? 0) - (a.mediscore ?? 0));
        break;
      case "price_asc":
        list.sort((a, b) => parseFloat(a.price) - parseFloat(b.price));
        break;
      case "price_desc":
        list.sort((a, b) => parseFloat(b.price) - parseFloat(a.price));
        break;
      case "newest":
        list.sort((a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime());
        break;
      case "relevance":
      default:
        list.sort((a, b) => (b.compatibilityScore ?? 0) - (a.compatibilityScore ?? 0));
    }
    return list;
  }, [rawLeads, sortBy]);

  const { data: orders = [] } = useQuery<(Order & { lead: Lead })[]>({
    queryKey: ['/api/orders'],
    enabled: !!user,
  });

  const purchasedLeadIds = useMemo(
    () => new Set(orders.map(o => o.leadId)),
    [orders]
  );

  const licensedStates = user?.profile?.licensedStates || [];

  const handlePurchase = async (leadId: number, price: string) => {
    try {
      const response = await fetch(`/api/leads/${leadId}/purchase`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Purchase failed');
      }

      toast({
        title: "Purchase successful!",
        description: `You've purchased lead #${leadId} for $${price}`,
      });

      queryClient.invalidateQueries({ predicate: q => typeof q.queryKey[0] === "string" && (q.queryKey[0] as string).startsWith("/api/leads") });
      queryClient.invalidateQueries({ queryKey: ['/api/auth/user'] });
      queryClient.invalidateQueries({ queryKey: ['/api/orders'] });
      setIsCompareOpen(false);
      setSelectedLeads([]);
      setIsDetailsOpen(false);
    } catch (error: any) {
      toast({
        title: "Purchase failed",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const handleDialogPurchase = async () => {
    if (!detailsLead) return;
    setIsDetailsPurchasing(true);
    await handlePurchase(detailsLead.id, detailsLead.price);
    setIsDetailsPurchasing(false);
  };

  const toggleCompare = (lead: Lead) => {
    if (selectedLeads.find(l => l.id === lead.id)) {
      setSelectedLeads(prev => prev.filter(l => l.id !== lead.id));
    } else {
      if (selectedLeads.length >= 4) return;
      setSelectedLeads(prev => [...prev, lead]);
    }
  };

  const handleViewDetails = (lead: Lead) => {
    setDetailsLead(lead);
    setIsDetailsOpen(true);
  };

  const toggleType = (type: string) => {
    setSelectedTypes(prev =>
      prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type]
    );
  };

  const toggleState = (state: string) => {
    setSelectedStates(prev =>
      prev.includes(state) ? prev.filter(s => s !== state) : [...prev, state]
    );
  };

  const isPurchased = detailsLead ? purchasedLeadIds.has(detailsLead.id) : false;

  // Shared filter rail content — rendered both in the desktop sidebar and the
  // mobile Drawer so the two stay in lockstep.
  const FilterRailContent = ({ onApply }: { onApply?: () => void }) => (
    <>
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-lg flex items-center gap-2">
          <Filter className="h-4 w-4" /> Filters
        </h3>
        {(selectedTypes.length > 0 || selectedStates.length > 0) && (
          <Button
            variant="ghost"
            size="sm"
            className="h-auto p-0 text-muted-foreground hover:text-foreground"
            onClick={() => { setSelectedTypes([]); setSelectedStates([]); }}
          >
            Clear all
          </Button>
        )}
      </div>

      <Accordion type="multiple" defaultValue={["type", "state", "price"]} className="w-full">

        <AccordionItem value="type" className="border-b-0 mb-4">
          <AccordionTrigger className="hover:no-underline py-2 font-medium">Lead Type</AccordionTrigger>
          <AccordionContent>
            <div className="space-y-3 pt-1">
              {["Medicare Advantage", "Medicare Supplement", "Final Expense"].map((type) => (
                <div key={type} className="flex items-center space-x-2">
                  <Checkbox
                    id={`type-${type}`}
                    checked={selectedTypes.includes(type)}
                    onCheckedChange={() => toggleType(type)}
                  />
                  <Label htmlFor={`type-${type}`} className="text-sm font-normal cursor-pointer">
                    {type}
                  </Label>
                </div>
              ))}
            </div>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="state" className="border-b-0 mb-4">
          <AccordionTrigger className="hover:no-underline py-2 font-medium">State</AccordionTrigger>
          <AccordionContent>
            <div className="grid grid-cols-2 gap-2 pt-1">
              {["FL", "TX", "CA", "AZ", "NC", "SC", "OH", "MI"].map((state) => {
                const isLicensed = licensedStates.includes(state);
                return (
                  <div key={state} className="flex items-center space-x-2">
                    <Checkbox
                      id={`state-${state}`}
                      checked={selectedStates.includes(state)}
                      onCheckedChange={() => toggleState(state)}
                    />
                    <Label
                      htmlFor={`state-${state}`}
                      className={`text-sm font-normal cursor-pointer flex items-center gap-1 ${isLicensed ? "text-success font-medium" : ""}`}
                    >
                      {state} {isLicensed && <span className="w-1.5 h-1.5 rounded-full bg-success"></span>}
                    </Label>
                  </div>
                );
              })}
            </div>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem value="price" className="border-b-0">
          <AccordionTrigger className="hover:no-underline py-2 font-medium">Price Range</AccordionTrigger>
          <AccordionContent>
            <div className="pt-4 px-2">
              <Slider
                defaultValue={[0, 100]}
                max={150}
                step={5}
                value={priceRange}
                onValueChange={setPriceRange}
                className="mb-4"
              />
              <div className="flex items-center justify-between text-sm text-muted-foreground">
                <span>${priceRange[0]}</span>
                <span>${priceRange[1]}</span>
              </div>
            </div>
          </AccordionContent>
        </AccordionItem>

      </Accordion>

      {onApply && (
        <Button className="w-full mt-2" onClick={onApply} data-testid="button-apply-mobile-filters">
          Apply filters
        </Button>
      )}
    </>
  );

  return (
    <Layout>
      <div className="flex flex-col gap-6">

        {/* Hero / Promo Section */}
        <div className="relative rounded-xl overflow-hidden min-h-[160px] flex items-center px-4 sm:px-8 py-6 shadow-sm">
          <div
            className="absolute inset-0 z-0"
            style={{
              backgroundImage: `url(${heroBg})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              filter: 'brightness(0.7)'
            }}
          />
          <div className="relative z-10 text-white max-w-2xl">
            <h1 className="text-2xl sm:text-3xl font-display font-bold mb-2 break-words">Verified High-Intent Leads</h1>
            <p className="text-white/80 text-base sm:text-lg">
              Access real-time Medicare Advantage shoppers. Validated by TrustedForm™.
            </p>
            <div className="mt-4 flex gap-2 flex-wrap">
              <Badge className="bg-emerald-500/20 text-emerald-100 hover:bg-emerald-500/30 border-emerald-500/50 backdrop-blur-sm">
                98% Contact Rate
              </Badge>
              <Badge className="bg-blue-500/20 text-blue-100 hover:bg-blue-500/30 border-blue-500/50 backdrop-blur-sm">
                TCPA Compliant
              </Badge>
              <Badge className="bg-amber-500/20 text-amber-100 hover:bg-amber-500/30 border-amber-500/50 backdrop-blur-sm">
                PII Protected
              </Badge>
            </div>
          </div>
        </div>

        {/* New-user onboarding card: shown only when the user has no licenses
            on file and no purchases yet. Hidden once they engage. */}
        {user && (user.profile?.licensedStates?.length ?? 0) === 0 && orders.length === 0 && (
          <div className="bg-primary/5 border border-primary/20 rounded-xl p-5 flex flex-col md:flex-row gap-4 items-start md:items-center justify-between">
            <div className="flex-1">
              <h3 className="text-lg font-semibold text-primary">Welcome to LeadMarket</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Get matched to high-intent leads. Three quick steps:
                <span className="font-medium text-foreground"> 1) add your licensed states</span>,
                <span className="font-medium text-foreground"> 2) fund your wallet</span>,
                <span className="font-medium text-foreground"> 3) onboard as an agent</span> to receive auto-routed leads.
              </p>
            </div>
            <div className="flex gap-2 flex-wrap">
              <a href="/profile" className="inline-flex h-9 items-center rounded-md bg-primary text-primary-foreground px-3 text-sm font-medium hover:bg-primary/90">Add licenses</a>
              <a href="/agent/onboarding" className="inline-flex h-9 items-center rounded-md border bg-background px-3 text-sm font-medium hover:bg-muted">Become an agent</a>
            </div>
          </div>
        )}

        <div className="flex flex-col md:flex-row gap-6 items-start">

          {/* Filters Sidebar — desktop only. Mobile uses the Drawer below. */}
          <div className="hidden md:block w-full md:w-64 flex-shrink-0 space-y-6 sticky top-24">
            <FilterRailContent />
          </div>

          {/* Listings Grid */}
          <div className="flex-1 min-w-0 w-full">
            {/* Mobile filter trigger */}
            <div className="md:hidden mb-3">
              <Drawer open={isFiltersOpen} onOpenChange={setIsFiltersOpen}>
                <DrawerTrigger asChild>
                  <Button
                    variant="outline"
                    className="w-full gap-2 h-11"
                    data-testid="button-mobile-filters"
                  >
                    <Filter className="h-4 w-4" /> Filters
                    {(selectedTypes.length + selectedStates.length) > 0 && (
                      <Badge variant="secondary" className="ml-1">
                        {selectedTypes.length + selectedStates.length}
                      </Badge>
                    )}
                  </Button>
                </DrawerTrigger>
                <DrawerContent className="max-h-[85vh]">
                  <DrawerHeader className="text-left">
                    <DrawerTitle>Filters</DrawerTitle>
                    <DrawerDescription>
                      Narrow the marketplace to leads that match your book.
                    </DrawerDescription>
                  </DrawerHeader>
                  <div className="px-4 pb-2 overflow-y-auto space-y-4">
                    <FilterRailContent onApply={() => setIsFiltersOpen(false)} />
                  </div>
                  <DrawerFooter>
                    <DrawerClose asChild>
                      <Button variant="ghost">Close</Button>
                    </DrawerClose>
                  </DrawerFooter>
                </DrawerContent>
              </Drawer>
            </div>

            <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
              <div className="text-sm text-muted-foreground">
                {isLoading ? (
                  <span>Loading...</span>
                ) : (
                  <>
                    Showing <span className="font-semibold text-foreground">{leads.length}</span> leads
                    {purchasedLeadIds.size > 0 && (
                      <span className="ml-2 text-blue-600">({purchasedLeadIds.size} owned)</span>
                    )}
                  </>
                )}
              </div>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-1.5 text-sm text-muted-foreground cursor-pointer">
                  <Checkbox checked={includeDnc} onCheckedChange={v => setIncludeDnc(!!v)} data-testid="checkbox-include-dnc" />
                  Show DNC-flagged
                </label>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">Sort by:</span>
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
                    className="h-8 rounded-md border bg-background px-2 text-sm"
                    data-testid="select-sort"
                  >
                    <option value="relevance">Relevance</option>
                    <option value="mediscore">MediScore</option>
                    <option value="newest">Newest</option>
                    <option value="price_asc">Price: low → high</option>
                    <option value="price_desc">Price: high → low</option>
                  </select>
                </div>
              </div>
            </div>

            {isLoading ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3 gap-6">
                  {leads.map((lead) => (
                    <LeadCard
                      key={lead.id}
                      lead={lead}
                      licensedStates={licensedStates}
                      onCompare={toggleCompare}
                      onViewDetails={handleViewDetails}
                      isSelectedForCompare={!!selectedLeads.find(l => l.id === lead.id)}
                      isPurchased={purchasedLeadIds.has(lead.id)}
                      isNew={newLeadIds.has(lead.id)}
                    />
                  ))}
                </div>

                {leads.length === 0 && (
                  <div className="text-center py-20 bg-muted/20 rounded-lg border border-dashed border-border">
                    <h3 className="text-lg font-medium">No leads found</h3>
                    <p className="text-muted-foreground">Try adjusting your filters to see more results.</p>
                    <Button
                      variant="link"
                      onClick={() => { setSelectedTypes([]); setSelectedStates([]); setPriceRange([0, 100]); }}
                    >
                      Clear all filters
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>

        </div>
      </div>

      {/* Comparison Drawer/Bar */}
      {selectedLeads.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 md:left-64 z-50 bg-card border-t shadow-2xl p-4 animate-in slide-in-from-bottom-10">
          <div className="max-w-7xl mx-auto flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="flex -space-x-2">
                {selectedLeads.map((lead) => (
                  <div key={lead.id} className="relative group">
                    <div className="h-10 w-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center border-2 border-background font-bold text-xs">
                      {lead.state}
                    </div>
                    <Button
                      size="icon"
                      variant="destructive"
                      className="h-4 w-4 absolute -top-1 -right-1 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={() => toggleCompare(lead)}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                ))}
              </div>
              <div>
                <p className="font-semibold">{selectedLeads.length} leads selected</p>
                <p className="text-xs text-muted-foreground">Compare up to 4 items</p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setSelectedLeads([])}>Clear</Button>
              <Drawer open={isCompareOpen} onOpenChange={setIsCompareOpen}>
                <DrawerTrigger asChild>
                  <Button className="gap-2">
                    <ArrowUpDown className="h-4 w-4" /> Compare Now
                  </Button>
                </DrawerTrigger>
                <DrawerContent className="h-[85vh]">
                  <DrawerHeader>
                    <DrawerTitle>Lead Specification Comparison</DrawerTitle>
                    <DrawerDescription>
                      Compare attributes side-by-side to find the best match for your portfolio.
                    </DrawerDescription>
                  </DrawerHeader>
                  <div className="p-4 flex-1 overflow-auto">
                    <div className="grid grid-cols-[150px_repeat(4,1fr)] gap-4 min-w-[800px]">
                      {/* Labels Column */}
                      <div className="space-y-4 pt-16 font-medium text-sm text-muted-foreground">
                        <div className="h-8 flex items-center">Price</div>
                        <div className="h-8 flex items-center">Match Score</div>
                        <div className="h-8 flex items-center">Type</div>
                        <div className="h-8 flex items-center">State</div>
                        <div className="h-8 flex items-center">Exclusivity</div>
                        <div className="h-8 flex items-center">Consumer Age</div>
                        <div className="h-8 flex items-center">Income</div>
                        <div className="h-8 flex items-center">Verified</div>
                        <div className="h-8 flex items-center">Source</div>
                        <div className="h-8 flex items-center">Vendor Rating</div>
                      </div>

                      {/* Lead Columns */}
                      {selectedLeads.map(lead => (
                        <div key={lead.id} className="space-y-4 border rounded-lg p-4 bg-card shadow-sm">
                          <div className="h-12 flex flex-col justify-center">
                            <span className="font-bold">#{lead.id}</span>
                            <span className="text-xs text-muted-foreground truncate">{lead.vendor.name}</span>
                          </div>

                          <div className="h-8 flex items-center font-bold text-lg text-primary">${lead.price}</div>
                          <div className="h-8 flex items-center">
                            <Badge variant={lead.compatibilityScore > 80 ? "default" : "secondary"}>
                              {lead.compatibilityScore}% Match
                            </Badge>
                          </div>
                          <div className="h-8 flex items-center text-sm">{lead.type}</div>
                          <div className="h-8 flex items-center text-sm font-semibold">{lead.state}</div>
                          <div className="h-8 flex items-center text-sm">{lead.exclusivity}</div>
                          <div className="h-8 flex items-center text-sm">{lead.consumerAge}</div>
                          <div className="h-8 flex items-center text-sm">{lead.income || "N/A"}</div>
                          <div className="h-8 flex items-center text-sm">
                            {lead.verified ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <span className="text-muted-foreground">-</span>}
                          </div>
                          <div className="h-8 flex items-center text-sm truncate" title={lead.source}>{lead.source}</div>
                          <div className="h-8 flex items-center text-sm">{lead.vendor.rating}/5.0</div>

                          {!purchasedLeadIds.has(lead.id) && (
                            <Button
                              className="w-full mt-4"
                              onClick={() => handlePurchase(lead.id, lead.price)}
                              data-testid={`button-purchase-compare-${lead.id}`}
                            >
                              Purchase Lead
                            </Button>
                          )}
                          {purchasedLeadIds.has(lead.id) && (
                            <div className="w-full mt-4 text-center text-sm text-emerald-600 font-medium flex items-center justify-center gap-1">
                              <CheckCircle2 className="h-4 w-4" /> Owned
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                  <DrawerFooter>
                    <DrawerClose asChild>
                      <Button variant="outline">Close Comparison</Button>
                    </DrawerClose>
                  </DrawerFooter>
                </DrawerContent>
              </Drawer>
            </div>
          </div>
        </div>
      )}

      <LeadDetailsDialog
        lead={detailsLead}
        open={isDetailsOpen}
        onOpenChange={setIsDetailsOpen}
        isPurchased={isPurchased}
        onPurchase={handleDialogPurchase}
        isPurchasing={isDetailsPurchasing}
      />
    </Layout>
  );
}
