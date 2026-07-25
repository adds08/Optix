"use client";
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Can } from "@/components/can";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Truck, Plus } from "lucide-react";
import { VehicleForm } from "@/components/vehicle-form";

export default function D02VehiclesPage() {
  const vehicles = trpc.vehicle.list.useQuery();
  const [showForm, setShowForm] = useState(false);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Vehicles</h1>
          <p className="text-muted-foreground">Trucks, trailers, and fleet tracking.</p>
        </div>
        <Can perm="vehicle.manage">
          <Button size="sm" onClick={() => setShowForm(true)}><Plus className="h-4 w-4" /> Vehicle</Button>
        </Can>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><Truck className="h-4 w-4" /> All Vehicles</CardTitle>
          <CardDescription>{vehicles.data?.length ?? 0} vehicles</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Unit</TableHead><TableHead>Type</TableHead><TableHead>Make/Model</TableHead>
                <TableHead>Plate</TableHead><TableHead>Ownership</TableHead><TableHead>Foreman</TableHead>
                <TableHead>Project</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {vehicles.data?.map((v) => (
                <TableRow key={v.id}>
                  <TableCell className="font-medium">{v.unit}</TableCell>
                  <TableCell><Badge variant="outline">{v.vehicleType}</Badge></TableCell>
                  <TableCell>{v.makeModel ?? "\u2014"}</TableCell>
                  <TableCell>{v.plate ?? "\u2014"}</TableCell>
                  <TableCell><Badge variant={v.ownershipType === "personal_allowance" ? "destructive" : "default"}>{v.ownershipType.replace("_", " ")}</Badge></TableCell>
                  <TableCell>{v.foremanName ?? "\u2014"}</TableCell>
                  <TableCell>{v.projectName ?? "\u2014"}</TableCell>
                </TableRow>
              ))}
              {!vehicles.data?.length && (
                <TableRow><TableCell colSpan={7} className="h-24 text-center text-muted-foreground">No vehicles yet.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <VehicleForm open={showForm} onClose={() => setShowForm(false)} />
    </div>
  );
}
