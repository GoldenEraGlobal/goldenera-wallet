import java.util.*;
import java.util.stream.*;
import global.goldenera.cryptoj.datatypes.Address;
import global.goldenera.wallet.api.core.v1.wallet.WalletApiV1;
import global.goldenera.wallet.api.core.v1.wallet.mappers.WalletMapperImpl;
import global.goldenera.wallet.client.node.model.v1.*;
import global.goldenera.wallet.service.business.WalletBusinessService;
import global.goldenera.wallet.service.node.*;
import global.goldenera.wallet.config.JacksonConfig;
import global.goldenera.wallet.config.WebConfig;
import org.springframework.format.support.DefaultFormattingConversionService;
import org.springframework.http.converter.json.Jackson2ObjectMapperBuilder;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders;

public class ReviewHarness {
  static final Address A = Address.fromHexString("0x1111111111111111111111111111111111111111");
  static final Address B = Address.fromHexString("0x2222222222222222222222222222222222222222");
  static final Address TOKEN = Address.fromHexString("0x3333333333333333333333333333333333333333");
  static final String ZERO = Address.ZERO.toHexString();
  static class Explorer extends ExplorerNodeService {
    List<MemTransferDtoV1> pending = new ArrayList<>();
    List<TransferDtoV1> confirmed = new ArrayList<>();
    Set<Address> lastBalanceAddresses;
    Explorer() { super(null,null,null,null,null); }
    @Override public AccountBalanceDtoV1Page getAccountBalancesBulk(Integer n, Integer size, Set<Address> a, Set<Address> t) {
      lastBalanceAddresses = a;
      return new AccountBalanceDtoV1Page().totalElements(1L)._list(List.of(new AccountBalanceDtoV1()
        .version(AccountBalanceDtoV1.VersionEnum.V1).address(A.toHexString()).tokenAddress(ZERO).balance("100")));
    }
    @Override public MemTransferDtoV1Page getMemTransfersBulk(Integer n, Integer size, Set<Address> a, Set<Address> t, BulkMemTransferPageRequestV1.TransferTypeEnum type) {
      var filtered = pending.stream().filter(x -> t.isEmpty() || t.contains(Address.fromHexString(x.getTokenAddress()))).toList();
      return new MemTransferDtoV1Page().totalElements((long)filtered.size())._list(filtered.stream().skip((long)n*size).limit(size).toList());
    }
    @Override public TransferDtoV1Page getTransfersBulk(Integer n, Integer size, Set<Address> a, Set<Address> t, BulkTransferPageRequestV1.TypeEnum type) {
      return new TransferDtoV1Page().totalElements((long)confirmed.size())._list(confirmed.stream().skip((long)n*size).limit(size).toList());
    }
  }
  static class Chain extends BlockchainNodeService {
    Chain() { super(null,null,null); }
    @Override public Long getLatestBlockHeight() { return 100L; }
  }
  public static void main(String[] args) throws Exception {
    var env = new org.springframework.core.env.StandardEnvironment();
    env.getPropertySources().addFirst(new org.springframework.core.env.MapPropertySource("review-only", Map.of("ge.node.base-url","http://example.invalid", "ge.node.api-key","synthetic", "ge.node.webhook-secret-key","synthetic", "ge.node.webhook-uid", "${REVIEW_MISSING_WEBHOOK_UID}")));
    var properties = org.springframework.boot.context.properties.bind.Binder.get(env).bind("ge.node", org.springframework.boot.context.properties.bind.Bindable.of(global.goldenera.wallet.properties.NodeProperties.class)).get();
    System.out.println("Missing webhook env binding="+properties.getWebhookUid());
    var mapper = new JacksonConfig().baseObjectMapper(new Jackson2ObjectMapperBuilder());
    try {
      mapper.readValue("{\"version\":\"V2\",\"balance\":\"100\",\"lockedMiningReward\":\"60\",\"spendableBalance\":\"40\"}", AccountBalanceDtoV1.class);
      System.out.println("V2 deserialization: unexpectedly succeeded");
    } catch (Exception e) {
      System.out.println("V2 deserialization: " + e.getClass().getSimpleName() + "; root=" + e.getCause().getMessage());
    }
    var explorer = new Explorer();
    var business = new WalletBusinessService(explorer, new Chain(), new WalletMapperImpl());
    for (int i=0;i<3;i++) explorer.pending.add(new MemTransferDtoV1().tokenAddress(ZERO).nonce((long)i));
    for (int i=0;i<30;i++) explorer.confirmed.add(new TransferDtoV1().nonce((long)i));
    var p0 = business.getTransfers(Set.of(A),Set.of(),0,20,null);
    var p1 = business.getTransfers(Set.of(A),Set.of(),1,20,null);
    System.out.println("Pagination page0 confirmed nonces="+p0.content().stream().filter(x->x.status().name().equals("CONFIRMED")).map(x->x.nonce()).toList());
    System.out.println("Pagination page1 confirmed nonces="+p1.content().stream().map(x->x.nonce()).toList()+" last="+p1.last()+"; expected [17..29]");
    explorer.pending=List.of(new MemTransferDtoV1().from(A.toHexString()).to(B.toHexString()).tokenAddress(TOKEN.toHexString()).amount("5").fee("7"));
    System.out.println("Native balance filtered="+business.getBalances(Set.of(A),Set.of(Address.ZERO)).getFirst().balance()+"; all tokens="+business.getBalances(Set.of(A),Set.of()).getFirst().balance()+"; expected 93 both");
    var conversion = new DefaultFormattingConversionService();
    new WebConfig().addFormatters(conversion);
    var mvc = MockMvcBuilders.standaloneSetup(new WalletApiV1(business)).setConversionService(conversion).build();
    var result = mvc.perform(MockMvcRequestBuilders.get("/api/core/v1/wallet/balances").param("addresses", "")).andReturn();
    System.out.println("Empty addresses HTTP="+result.getResponse().getStatus()+"; passed addresses="+explorer.lastBalanceAddresses);
  }
}
