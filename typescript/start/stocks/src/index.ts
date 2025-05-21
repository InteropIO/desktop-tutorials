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
// const toggleIOAvailable = (): void => {
//     const span = document.getElementById("ioConnectSpan");
//     if (!span) return;

//     span.classList.remove("bg-danger");
//     span.classList.add("bg-success");
//     span.textContent = "io.Connect is available";
// };

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
};

const stockClickedHandler = async (stock: StockWithPrices): Promise<void> => {
    // TODO: Chapter 4.1
    window.location.href = `http://${window.location.host}/details/index.html`;

    // TODO: Chapter 8.3

    // TODO: Chapter 9.5
};

const exportPortfolioButtonHandler = async (portfolio: Stock[]): Promise<void> => {
    // TODO: Chapter 10.2
};

const start = async (): Promise<void> => {
    const stocksResponse = await fetch("http://localhost:8080/api/portfolio");
    const stocks = await stocksResponse.json() as StockWithPrices[];

    setupStocks(stocks);
    generateStockPrices(newPricesHandler);

    // TODO: Chapter 3

    // TODO: Chapter 12.1

    // TODO: Chapter 5.1

    // TODO: Chapter 6.2

    // TODO: Chapter 8.2

    // TODO: Chapter 7.2

    // TODO: Chapter 9.4

    // TODO: Chapter 10.2
    // const exportPortfolioButton = document.getElementById("exportPortfolio");

    // exportPortfolioButton.onclick = () => {
    //     if (!clientPortfolioStocks) {
    //         return;
    //     }

    //     exportPortfolioButtonHandler(clientPortfolioStocks).catch(console.error);
    // };
};

// Add window properties when needed
declare global {
    interface Window {
        io?: IODesktopAPI;
        priceStream?: any;
    }
}

start().catch(console.error);