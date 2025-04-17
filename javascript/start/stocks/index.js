let clientPortfolioStocks;
let clientName;

const generateStockPrices = (handleNewPrices) => {
    setInterval(() => {
        const priceUpdate = {
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

const setupStocks = (stocks) => {
    const table = document.getElementById("stocksTable").getElementsByTagName("tbody")[0];

    table.innerHTML = "";

    const addRowCell = (row, cellData, cssClass) => {
        const cell = document.createElement("td");

        cell.innerText = cellData;

        if (cssClass) {
            cell.className = cssClass;
        };
        row.appendChild(cell);
    };

    const addRow = (table, stock) => {
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
const toggleIOAvailable = () => {
    const span = document.getElementById("ioConnectSpan");

    span.classList.remove("bg-danger");
    span.classList.add("bg-success");
    span.textContent = "io.Connect is available";
};

const newPricesHandler = (priceUpdate) => {
    priceUpdate.stocks.forEach((stock) => {
        const row = document.querySelectorAll(`[data-ric="${stock.RIC}"]`)[0];

        if (!row) {
            return;
        };

        const bidElement = row.children[2];
        bidElement.innerText = stock.Bid;

        const askElement = row.children[3];
        askElement.innerText = stock.Ask;
    });

    // TODO: Chapter 5.1
    if (priceStream) {
        priceStream.push(priceUpdate);
    };
};

const stockClickedHandler = (stock) => {
    // TODO: Chapter 4.1
    // window.location.href = `http://${window.location.host}/details/index.html`;
    const name = `${stock.BPOD} Details`;
    const URL = "http://localhost:9100/details/";
    const config = {
        left: 100,
        top: 100,
        width: 550,
        height: 350,
        context: stock
    };

    // Check whether the clicked stock has already been opened in a new window.
    const stockWindowExists = io.windows.list().find(w => w.name === name);

    if (!stockWindowExists) {
        io.windows.open(name, URL, config).catch(console.error);
    };

    // TODO: Chapter 7.3

    // TODO: Chapter 9.6
};

const exportPortfolioButtonHandler = async (portfolio) => {
    // TODO: Chapter 10.2
};


const start = async () => {
    const stocksResponse = await fetch("http://localhost:8080/api/portfolio");
    const stocks = await stocksResponse.json();

    setupStocks(stocks);
    generateStockPrices(newPricesHandler);

    // TODO: Chapter 3
    const config = {
        channels: true
    };

    const io = await IODesktop(config);

    window.io = io;

    toggleIOAvailable();

    // TODO: Chapter 5.1
    // const methodName = "SelectClient";
    // const methodHandler = (args) => {
    //     const clientPortfolio = args.client.portfolio;
    //     const stockToShow = stocks.filter(stock => clientPortfolio.includes(stock.RIC));

    //     setupStocks(stockToShow);
    // };

    // io.interop.register(methodName, methodHandler);

    window.priceStream = await io.interop.createStream("LivePrices");

    // TODO: Chapter 6.2
    // const updateHandler = (client) => {
    //     const clientPortfolio = client.portfolio;
    //     const stockToShow = stocks.filter(stock => clientPortfolio.includes(stock.RIC));

    //     setupStocks(stockToShow);
    // };

    // io.contexts.subscribe("SelectedClient", updateHandler);

    // TODO: Chapter 8.2

    // TODO: Chapter 7.2
    const updateHandler = (client) => {
        if (client.portfolio) {
            const clientPortfolio = client.portfolio;
            const stockToShow = stocks.filter(stock => clientPortfolio.includes(stock.RIC));

            setupStocks(stockToShow);
        };
    };

    io.channels.subscribe(updateHandler);

    // TODO: Chapter 9.5

    // TODO: Chapter 10.2
    // const exportPortfolioButton = document.getElementById("exportPortfolio");

    // exportPortfolioButton.onclick = () => {
    //     if (!clientPortfolioStocks) {
    //         return;
    //     };

    //     exportPortfolioButtonHandler(clientPortfolioStocks).catch(console.error);
    // };
};

start().catch(console.error);