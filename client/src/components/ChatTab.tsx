import { useState, useRef, useEffect } from 'react'; // Import useRef and useEffect
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
    // Ref for the end of the messages list to enable auto-scrolling
    const messagesEndRef = useRef<HTMLDivElement>(null);

    // Effect to scroll to the bottom whenever messages change
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages]); // Dependency array includes messages

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

            // Log final response details if needed
            console.log("Final Assistant Response:", assistantResponse);

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
        // Use mt-4 for spacing like other tabs
        <TabsContent value="chat" className="mt-4">
            {/* Main container: Set fixed height, flex column, border */}
            <div className="flex flex-col border rounded overflow-hidden" style={{ height: '500px' }}>
                {/* Message display area: grow and scroll */}
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
                    {/* Empty div at the end of messages to scroll to */}
                    <div ref={messagesEndRef} />
                </div>
                {/* Input form area: Prevent shrinking */}
                <form onSubmit={handleSubmit} className="flex-shrink-0 p-4 border-t flex items-center gap-2 bg-background">
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
