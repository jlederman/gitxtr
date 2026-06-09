namespace Gitxtr.Host.Messaging;

internal interface IMessageHandler
{
    /// <summary>Handle a message and return the data payload, or null for void commands.
    /// Throw on error — the dispatcher wraps exceptions into ok:false responses.</summary>
    object? Handle(MessageContext ctx);
}
