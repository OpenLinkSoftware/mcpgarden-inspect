import { useState } from 'react';
import { TabsContent } from "@/components/ui/tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createGoogleGenerativeAI } from '@ai-sdk/google'; // Import createGoogleGenerativeAI instead of google
import { streamText, CoreMessage } from 'ai'; // Import streamText and CoreMessage type
import { Loader2 } from 'lucide-react'; // For loading indicator

// Create provider instance once outside the handler
const googleProvider = createGoogleGenerativeAI({
    apiKey: import.meta.env.VITE_GOOGLE_GENERATIVE_AI_API_KEY,
});


const ChatTab = () => {
    // State for messages in the chat
    const [messages, setMessages] = useState<CoreMessage[]>([]);
    // State for the user's current input
    const [input, setInput] = useState('');
    // State to track if the AI is currently generating a response
    const [isLoading, setIsLoading] = useState(false);

    // Update input state as user types
    const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        setInput(event.target.value);
    };

    // Handle form submission (sending a message)
    const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        // Prevent sending empty messages or sending while loading
        if (!input.trim() || isLoading) return;

        // Add user message to the chat history immediately for responsiveness
        const newUserMessage: CoreMessage = { role: 'user', content: input };
        const updatedMessages = [...messages, newUserMessage];
        setMessages(updatedMessages);

        setInput(''); // Clear input field
        setIsLoading(true); // Show loading indicator

        try {
            // --- Call the AI ---
            // Note: This basic implementation sends only the latest user message.
            // Pass the updated message history to the AI
            console.log(`Streaming text with history...`);

            const result = await streamText({
                model: googleProvider('models/gemini-2.0-flash-001', { // Use new model ID
                    // Add any specific settings if needed
                }),
                messages: updatedMessages, // Pass the full message history
            });

            // --- Stream AI Response ---
            let assistantResponse = "";
            let assistantMessageAdded = false;

            for await (const textPart of result.textStream) {
                assistantResponse += textPart;
                if (!assistantMessageAdded) {
                    // Add the initial assistant message shell
                    setMessages(prev => [...prev, { role: 'assistant', content: assistantResponse }]);
                    assistantMessageAdded = true;
                } else {
                    // Update the last message (assistant's response) incrementally
                    setMessages(prev => {
                        const lastMessageIndex = prev.length - 1;
                        const updated = [...prev];
                        // Ensure the last message exists and is from the assistant before updating
                        if (lastMessageIndex >= 0 && updated[lastMessageIndex].role === 'assistant') {
                            updated[lastMessageIndex] = {
                                ...updated[lastMessageIndex],
                                content: assistantResponse
                            };
                        }
                        return updated;
                    });
                }
            }

            // Log final response details if needed (sources might not be available with streamText easily)
            console.log("Final Assistant Response:", assistantResponse);
            // console.log("Sources:", result.sources); // Check SDK documentation for how sources are handled with streamText
            // console.log("Provider Metadata:", result.providerMetadata); // Check SDK documentation

        } catch (error) {
            // Handle potential errors during AI generation or streaming
            console.error("Error generating text:", error);
            const errorMessage: CoreMessage = {
                role: 'assistant',
                content: `Error generating response: ${error instanceof Error ? error.message : String(error)}`
            };
            setMessages(prev => [...prev, errorMessage]);
        } finally {
            // Hide loading indicator
            setIsLoading(false);
        }
    };

    return (
        // Use 'h-full' on TabsContent if parent allows, or adjust relative height
        <TabsContent value="chat" className="h-full flex flex-col">
            {/* Main container for chat interface - Use flex-grow */}
            <div className="flex flex-col flex-grow border rounded overflow-hidden"> {/* Added overflow-hidden */}
                {/* Message display area - Should grow and scroll */}
                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                    {messages.length === 0 ? (
                        // Initial message if chat history is empty
                        <Alert className="bg-background">
                            <AlertTitle>Chat Ready</AlertTitle>
                            <AlertDescription>
                                Send a message using the input below to start chatting with the AI.
                            </AlertDescription>
                        </Alert>
                    ) : (
                        // Render message history
                        messages.map((msg, index) => (
                            <div
                                key={index}
                                className={`p-3 rounded-lg max-w-[85%] ${msg.role === 'user'
                                    ? 'bg-primary text-primary-foreground self-end ml-auto' // User message style
                                    : 'bg-muted text-muted-foreground self-start mr-auto' // AI message style
                                    }`}
                            >
                                {/* Use <pre> for better formatting of potential code/markdown */}
                                {/* Ensure content is a string before rendering, provide fallback */}
                                <pre className="text-sm whitespace-pre-wrap font-sans">
                                    {typeof msg.content === 'string'
                                        ? msg.content
                                        : JSON.stringify(msg.content, null, 2)}
                                </pre>
                            </div>
                        ))
                    )}
                    {/* Loading indicator */}
                    {isLoading && (
                        <div className="flex justify-center items-center p-3 text-muted-foreground">
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            AI is thinking...
                        </div>
                    )}
                </div>
                {/* Input form area */}
                <form onSubmit={handleSubmit} className="p-4 border-t flex items-center gap-2 bg-background">
                    <Input
                        type="text"
                        placeholder="Send a message..."
                        value={input}
                        onChange={handleInputChange}
                        className="flex-1"
                        disabled={isLoading} // Disable input while loading
                        aria-label="Chat input"
                    />
                    <Button type="submit" disabled={isLoading || !input.trim()}>
                        {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Send"}
                    </Button>
                </form>
            </div>
        </TabsContent>
    );
};

export default ChatTab;
