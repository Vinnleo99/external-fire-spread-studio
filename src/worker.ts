import { computeFacade } from "./compute";
import { Facade, TableEntry } from "./engine/model";
import { SiteProject } from "./engine/site";
import { assessSite } from "./engine/siteAssessment";
import tableData from "./data/br187_1991_table1.json";

const table = tableData as TableEntry[];

type Message = { kind?: "facade"; requestId: number; facade: Facade } | { kind: "site"; requestId: number; project: SiteProject };

self.onmessage = (event: MessageEvent<Message>) => {
  const data = event.data;
  try {
    if (data.kind === "site") {
      const results = assessSite(data.project);
      (self as unknown as Worker).postMessage({ requestId: data.requestId, kind: "site", results });
    } else {
      const results = computeFacade(data.facade, table);
      (self as unknown as Worker).postMessage({ requestId: data.requestId, results });
    }
  } catch (error) {
    (self as unknown as Worker).postMessage({ requestId: data.requestId, kind: data.kind, error: String(error) });
  }
};
