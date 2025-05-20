const WebSocket = require('ws');

class RPSGame {
  constructor(port = 8080) {
    this.server = new WebSocket.Server({ port });
    this.players = [];
    this.waitingPlayers = [];
    this.activeGames = new Map();
    this.nextGameId = 1;
    
    console.log(`Game server started on port ${port}`);
    this.initServer();
  }

  initServer() {
    this.server.on('connection', (socket) => this.handleConnection(socket));
    this.server.on('error', (error) => console.error('Server error:', error));
  }

  handleConnection(socket) {
    // Assign a unique ID to each player
    socket.id = Date.now() + Math.floor(Math.random() * 1000);
    
    console.log(`Player ${socket.id} connected`);
    
    // Send welcome message
    this.sendToPlayer(socket, {
      type: 'info',
      message: 'Хайч чулуу даавуу тоглоомонд тавтай морил! Өрсөлдөгчийг хүлээр байна...'
    });
    
    // Set up event handlers
    socket.on('message', (data) => this.handleMessage(socket, data));
    socket.on('close', () => this.handleDisconnect(socket));
    socket.on('error', (error) => this.handleSocketError(socket, error));
    
    // Add to waiting players
    this.waitingPlayers.push(socket);
    this.players.push(socket);
    
    // Try to match players
    this.matchPlayers();
  }

  handleMessage(socket, message) {
    try {
      const data = JSON.parse(message);
      
      switch (data.type) {
        case 'move':
          this.handlePlayerMove(socket, data.choice);
          break;
        case 'chat':
          this.handleChat(socket, data.message);
          break;
        case 'rematch':
          this.handleRematchRequest(socket);
          break;
        default:
          this.sendToPlayer(socket, {
            type: 'error',
            message: 'Unknown message type'
          });
      }
    } catch (error) {
      console.error('Error processing message:', error);
      this.sendToPlayer(socket, {
        type: 'error',
        message: 'Invalid message format. Please send JSON.'
      });
    }
  }

  handlePlayerMove(socket, choice) {
    // Validate the move
    const validMoves = ['rock', 'paper', 'scissors'];
    if (!validMoves.includes(choice)) {
      return this.sendToPlayer(socket, {
        type: 'error',
        message: 'Invalid move. Choose rock, paper, or scissors.'
      });
    }

    // Find the player's game
    const gameId = this.findPlayerGame(socket);
    if (!gameId) {
      return this.sendToPlayer(socket, {
        type: 'error',
        message: 'You are not in an active game.'
      });
    }

    const game = this.activeGames.get(gameId);
    
    // Record the player's choice
    if (game.player1.socket === socket) {
      game.player1.choice = choice;
      game.player1.ready = true;
    } else {
      game.player2.choice = choice;
      game.player2.ready = true;
    }

    // Notify player their choice was recorded
    this.sendToPlayer(socket, {
      type: 'moveConfirm',
      choice
    });

    // If both players have chosen, determine the winner
    if (game.player1.ready && game.player2.ready) {
      this.determineGameResult(gameId);
    }
  }

  handleChat(socket, message) {
    const gameId = this.findPlayerGame(socket);
    if (!gameId) return;

    const game = this.activeGames.get(gameId);
    const opponent = game.player1.socket === socket ? game.player2.socket : game.player1.socket;
    
    this.sendToPlayer(opponent, {
      type: 'chat',
      message,
      from: 'opponent'
    });
  }

  handleRematchRequest(socket) {
    const gameId = this.findPlayerGame(socket);
    if (!gameId) return;

    const game = this.activeGames.get(gameId);
    
    if (game.player1.socket === socket) {
      game.player1.wantsRematch = true;
    } else {
      game.player2.wantsRematch = true;
    }

    // If both want a rematch, reset the game
    if (game.player1.wantsRematch && game.player2.wantsRematch) {
      this.resetGame(gameId);
    } else {
      // Notify the other player about rematch request
      const opponent = game.player1.socket === socket ? game.player2.socket : game.player1.socket;
      this.sendToPlayer(opponent, {
        type: 'rematchRequest'
      });
    }
  }

  handleDisconnect(socket) {
    console.log(`Player ${socket.id} disconnected`);
    
    // Remove from players list
    this.players = this.players.filter(p => p !== socket);
    this.waitingPlayers = this.waitingPlayers.filter(p => p !== socket);
    
    // Handle active game disconnection
    const gameId = this.findPlayerGame(socket);
    if (gameId) {
      const game = this.activeGames.get(gameId);
      const opponent = game.player1.socket === socket ? game.player2.socket : game.player1.socket;
      
      // Notify opponent
      this.sendToPlayer(opponent, {
        type: 'opponentLeft',
        message: 'Your opponent has disconnected.'
      });
      
      // Return opponent to waiting pool
      this.waitingPlayers.push(opponent);
      
      // Remove the game
      this.activeGames.delete(gameId);
      
      // Try to match waiting players
      this.matchPlayers();
    }
  }

  handleSocketError(socket, error) {
    console.error(`Error with player ${socket.id}:`, error);
    // Handle any cleanup needed
  }

  matchPlayers() {
    // Match waiting players into games
    while (this.waitingPlayers.length >= 2) {
      const gameId = this.nextGameId++;
      const player1 = this.waitingPlayers.shift();
      const player2 = this.waitingPlayers.shift();
      
      this.createGame(gameId, player1, player2);
    }
  }

  createGame(gameId, player1Socket, player2Socket) {
    // Initialize a new game
    const game = {
      player1: {
        socket: player1Socket,
        choice: null,
        ready: false,
        score: 0,
        wantsRematch: false
      },
      player2: {
        socket: player2Socket,
        choice: null,
        ready: false,
        score: 0,
        wantsRematch: false
      },
      rounds: 0
    };
    
    this.activeGames.set(gameId, game);
    
    // Notify players
    this.sendToPlayer(player1Socket, {
      type: 'gameStart',
      player: 1,
      gameId
    });
    
    this.sendToPlayer(player2Socket, {
      type: 'gameStart',
      player: 2,
      gameId
    });
  }

  determineGameResult(gameId) {
    const game = this.activeGames.get(gameId);
    const p1Choice = game.player1.choice;
    const p2Choice = game.player2.choice;
    
    let result;
    if (p1Choice === p2Choice) {
      result = 'draw';
    } else if (
      (p1Choice === 'rock' && p2Choice === 'scissors') ||
      (p1Choice === 'paper' && p2Choice === 'rock') ||
      (p1Choice === 'scissors' && p2Choice === 'paper')
    ) {
      result = 'player1';
      game.player1.score++;
    } else {
      result = 'player2';
      game.player2.score++;
    }
    
    game.rounds++;
    
    // Send results to players
    this.sendToPlayer(game.player1.socket, {
      type: 'roundResult',
      yourChoice: p1Choice,
      opponentChoice: p2Choice,
      result: result === 'player1' ? 'win' : result === 'player2' ? 'lose' : 'draw',
      yourScore: game.player1.score,
      opponentScore: game.player2.score,
      round: game.rounds
    });
    
    this.sendToPlayer(game.player2.socket, {
      type: 'roundResult',
      yourChoice: p2Choice,
      opponentChoice: p1Choice,
      result: result === 'player2' ? 'win' : result === 'player1' ? 'lose' : 'draw',
      yourScore: game.player2.score,
      opponentScore: game.player1.score,
      round: game.rounds
    });
    
    // Reset for next round
    game.player1.choice = null;
    game.player1.ready = false;
    game.player2.choice = null;
    game.player2.ready = false;
  }

  resetGame(gameId) {
    const game = this.activeGames.get(gameId);
    
    // Reset game state
    game.player1.choice = null;
    game.player1.ready = false;
    game.player1.wantsRematch = false;
    
    game.player2.choice = null;
    game.player2.ready = false;
    game.player2.wantsRematch = false;
    
    // Keep scores for ongoing matches
    // Reset round counter
    game.rounds = 0;
    
    // Notify players
    this.sendToPlayer(game.player1.socket, {
      type: 'gameReset',
      message: 'New game started!'
    });
    
    this.sendToPlayer(game.player2.socket, {
      type: 'gameReset',
      message: 'New game started!'
    });
  }

  findPlayerGame(playerSocket) {
    for (const [gameId, game] of this.activeGames.entries()) {
      if (game.player1.socket === playerSocket || game.player2.socket === playerSocket) {
        return gameId;
      }
    }
    return null;
  }

  sendToPlayer(socket, data) {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(data));
    }
  }
}

// Start the server
const game = new RPSGame();

// For testing and debugging purposes, handle server shutdown gracefully
process.on('SIGINT', () => {
  console.log('Shutting down server...');
  game.server.close(() => {
    console.log('Server shut down');
    process.exit(0);
  });
});