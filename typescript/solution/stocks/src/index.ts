let clientPortfolioStocks: Stock[] | undefined;
let clientName: string | undefined;

interface PriceUpdate {
    stocks: {
        RIC: string;
        Bid: string;
        Ask: string;
    }[];
}

interface StockWithPrices extends Stock {
    Bid?: string;
    Ask?: string;
    Description?: string;
}

const generateStockPrices = (handleNewPrices: (update: PriceUpdate) => void): void => {
    setInterval(() => {
        const priceUpdate: PriceUpdate = {
            stocks: [
                {
                    RIC: "VOD.L",
                    Bid: Number(70 - Math.random() * 10).toFixed(2),
                    Ask: Number(70 + Math.random() * 10).toFixed(2)
                },
                {
                    RIC: "TSCO.L",
                    Bid: Number(90 - Math.random() * 10).toFixed(2),
                    Ask: Number(90 + Math.random() * 10).toFixed(2)
                },
                {
                    RIC: "BARC.L",
                    Bid: Number(105 - Math.random() * 10).toFixed(2),
                    Ask: Number(105 + Math.random() * 10).toFixed(2)
                },
                {
                    RIC: "BMWG.DE",
                    Bid: Number(29 - Math.random() * 10).toFixed(2),
                    Ask: Number(29 + Math.random() * 10).toFixed(2)
                },
                {
                    RIC: "AAL.L",
                    Bid: Number(46 - Math.random() * 10).toFixed(2),
                    Ask: Number(46 + Math.random() * 10).toFixed(2)
                },
                {
                    RIC: "IBM.N",
                    Bid: Number(70 - Math.random() * 10).toFixed(2),
                    Ask: Number(70 + Math.random() * 10).toFixed(2)
                },
                {
                    RIC: "AAPL.OQ",
                    Bid: Number(90 - Math.random() * 10).toFixed(2),
                    Ask: Number(90 + Math.random() * 10).toFixed(2)
                },
                {
                    RIC: "BA.N",
                    Bid: Number(105 - Math.random() * 10).toFixed(2),
                    Ask: Number(105 + Math.random() * 10).toFixed(2)
                },
                {
                    RIC: "TSLA:OQ",
                    Bid: Number(29 - Math.random() * 10).toFixed(2),
                    Ask: Number(29 + Math.random() * 10).toFixed(2)
                },
                {
                    RIC: "ENBD.DU",
                    Bid: Number(46 - Math.random() * 10).toFixed(2),
                    Ask: Number(46 + Math.random() * 10).toFixed(2)
                },
                {
                    RIC: "AMZN.OQ",
                    Bid: Number(29 - Math.random() * 10).toFixed(2),
                    Ask: Number(29 + Math.random() * 10).toFixed(2)
                },
                {
                    RIC: "MSFT:OQ",
                    Bid: Number(46 - Math.random() * 10).toFixed(2),
                    Ask: Number(46 + Math.random() * 10).toFixed(2)
                }
            ]
        };

        handleNewPrices(priceUpdate);
    }, 1500);
};

const setupStocks = (stocks: StockWithPrices[]): void => {
    const tableElement = document.getElementById("stocksTable");
    if (!tableElement) return;
    
    const table = tableElement.getElementsByTagName("tbody")[0];
    if (!table) return;

    table.innerHTML = "";

    const addRowCell = (row: HTMLTableRowElement, cellData: string, cssClass?: string): void => {
        const cell = document.createElement("td");

        cell.innerText = cellData;

        if (cssClass) {
            cell.className = cssClass;
        }
        row.appendChild(cell);
    };

    const addRow = (table: HTMLTableSectionElement, stock: StockWithPrices): void => {
        const row = document.createElement("tr");

        addRowCell(row, stock.RIC || "");
        addRowCell(row, stock.Description || "");
        addRowCell(row, stock.Bid || "");
        addRowCell(row, stock.Ask || "");

        row.setAttribute("data-ric", stock.RIC);

        row.onclick = () => {
            stockClickedHandler(stock);
        };

        table.appendChild(row);
    };

    stocks.forEach((stock) => {
        addRow(table, stock);
    });
};

// TODO: Chapter 3
const toggleIOAvailable = (): void => {
    const span = document.getElementById("ioConnectSpan");
    if (!span) return;

    span.classList.remove("bg-danger");
    span.classList.add("bg-success");
    span.textContent = "io.Connect is available";
};

const newPricesHandler = (priceUpdate: PriceUpdate): void => {
    priceUpdate.stocks.forEach((stock) => {
        const row = document.querySelectorAll(`[data-ric="${stock.RIC}"]`)[0] as HTMLTableRowElement;

        if (!row) {
            return;
        }

        const bidElement = row.children[2];
        if (bidElement) bidElement.textContent = stock.Bid;

        const askElement = row.children[3];
        if (askElement) askElement.textContent = stock.Ask;
    });

    // TODO: Chapter 5.1
    if (window.priceStream) {
        window.priceStream.push(priceUpdate);
    }
};

const stockClickedHandler = async (stock: StockWithPrices): Promise<void> => {
    // TODO: Chapter 9.5
    let detailsWindow;

    const myWorkspace = await window.io.workspaces.getMyWorkspace();

    // Using any here since the API is not fully typed
    let detailsWorkspaceWindow = (myWorkspace as any).getWindow((window: any) => window.appName === "stock-details");

    if (detailsWorkspaceWindow) {
        detailsWindow = detailsWorkspaceWindow.getGdWindow();
    } else {
        const myId = (window.io.windows as any).my().id;
        const myImmediateParent = myWorkspace.getWindow((window: any) => window.id === myId).parent;
        const group = await myImmediateParent.parent.addGroup();

        detailsWorkspaceWindow = await group.addWindow({ appName: "stock-details" });

        await detailsWorkspaceWindow.forceLoad();

        detailsWindow = detailsWorkspaceWindow.getGdWindow();
    }

    detailsWindow.updateContext({ stock });
};

const exportPortfolioButtonHandler = async (portfolio: Stock[]): Promise<void> => {
    // TODO: Chapter 10.2
    try {
        const intents = await (window.io.intents as any).find("ExportPortfolio");

        if (!intents) {
            return;
        }

        const intentRequest = {
            intent: "ExportPortfolio",
            context: {
                type: "ClientPortfolio",
                data: { portfolio, clientName }
            }
        };

        await (window.io.intents as any).raise(intentRequest);

    } catch (error) {
        console.error((error as Error).message);
    }
};

const start = async (): Promise<void> => {
    const html = document.documentElement;
    const initialTheme = iodesktop.theme;

    html.className = initialTheme;

    const stocksResponse = await fetch("http://localhost:8080/api/portfolio");
    const stocks = await stocksResponse.json() as StockWithPrices[];

    setupStocks(stocks);
    generateStockPrices(newPricesHandler);

    // TODO: Chapter 3
    const config = {
        // channels: true,
        // appManager: "full",
        libraries: [IOWorkspaces]
    };

    const io = await IODesktop(config);

    window.io = io;

    toggleIOAvailable();

    // TODO: Chapter 12.1
    const themeHandler = (newTheme: Theme): void => {
        html.className = newTheme.name;
    };

    io.themes.onChanged(themeHandler);

    // TODO: Chapter 5.1
    window.priceStream = await (io.interop as any).createStream("LivePrices");

    // TODO: Chapter 9.4
    const myWorkspace = await io.workspaces.getMyWorkspace();

    if (myWorkspace) {
        const updateHandler = (context: any): void => {
            if (context.client) {
                const clientPortfolio = context.client.portfolio;
                clientPortfolioStocks = stocks.filter((stock) => clientPortfolio.includes(stock.RIC));
                clientName = context.client.name;

                setupStocks(clientPortfolioStocks);
            }
        };

        myWorkspace.onContextUpdated(updateHandler);
    }

    // TODO: Chapter 10.2
    const exportPortfolioButton = document.getElementById("exportPortfolio");
    if (!exportPortfolioButton) return;

    exportPortfolioButton.onclick = () => {
        if (!clientPortfolioStocks) {
            return;
        }

        exportPortfolioButtonHandler(clientPortfolioStocks).catch(console.error);
    };
};

// Add extended properties to window object
declare global {
    interface Window {
        io: IODesktopAPI;
        priceStream: any;
    }
}

start().catch(console.error);